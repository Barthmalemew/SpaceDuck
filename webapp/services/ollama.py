import os
import asyncio
from enum import Enum
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import Optional, Dict, Any
import httpx

load_dotenv()

class InitializationState(Enum):
    NOT_STARTED = "not_started"
    CHECKING_SERVICE = "checking_service"
    DOWNLOADING_MODEL = "downloading_model"
    TESTING_MODEL = "testing_model"
    READY = "ready"
    FAILED = "failed"

class OllamaService:
    def __init__(self):
        self.base_url = os.getenv("OLLAMA_API_HOST", "http://localhost:11434")
        self.health_check_timeout = 5  # seconds
        self.default_model = os.getenv("OLLAMA_DEFAULT_MODEL", "llama2")
        self.is_initialized = False
        self.initialization_error: Optional[str] = None
        self.initialization_status = InitializationState.NOT_STARTED
        self.model_loaded = False

    async def check_ollama_running(self):
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/version",
                    timeout=self.health_check_timeout
                )
                response.raise_for_status()

                if response.status_code == 200:
                    print("Ollama service is running and responding")
                    return True

            except httpx.RequestError:
                raise RuntimeError("Ollama service is not running or not accessible")
            except httpx.TimeoutException:
                raise RuntimeError("Ollama service health check timed out")

        return False

    async def pull_model(self, model_name: str) -> None:
        """Pull a model from Ollama's registry."""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/pull",
                    json={"name": model_name},
                    timeout=600  # 10 minute timeout for model downloads
                )
                response.raise_for_status()

                if response.status_code == 200:
                    print(f"Successfully pulled model: {model_name}")
                else:
                    raise RuntimeError(f"Failed to pull model {model_name}: Unexpected status {response.status_code}")

            except httpx.TimeoutException:
                raise RuntimeError(f"Timeout while pulling model {model_name}")
            except httpx.RequestError as e:
                raise RuntimeError(f"Failed to pull model {model_name}: {str(e)}")

    async def initialize(self):
        if self.is_initialized:
            return

        max_retries = 3
        print("Initializing Ollama service...")
        try:
            self.initialization_status = InitializationState.CHECKING_SERVICE
            for attempt in range(max_retries):
                try:
                    if await self.check_ollama_running():
                        break
                except RuntimeError as e:
                    if attempt == max_retries - 1:
                        raise
                    print(f"Retry {attempt + 1}/{max_retries}: {str(e)}")
                    await asyncio.sleep(2)

            models = await self.list_models()
            if not any(model["name"] == self.default_model for model in models["models"]):
                print(f"Default model {self.default_model} not found, downloading...")
                self.initialization_status = InitializationState.DOWNLOADING_MODEL
                await self.pull_model(self.default_model)
            else:
                print(f"Model {self.default_model} is already downloaded.")

            self.initialization_status = InitializationState.TESTING_MODEL
            await self._test_model()

            self.is_initialized = True
            self.initialization_status = InitializationState.READY
            self.initialization_error = None
            print("Ollama service initialization complete.")
        except Exception as e:
            self.initialization_status = InitializationState.FAILED
            self.initialization_error = str(e)
            print(f"Initialization failed: {str(e)}")
            raise

    async def _test_model(self) -> None:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.default_model,
                        "prompt": "Respond with 'OK' if you can read this message.",
                        "stream": False
                    },
                    timeout=10
                )
                response.raise_for_status()
                result = response.json()

                if not result or "response" not in result:
                    raise RuntimeError("Model test failed: empty or invalid response")

                print("Model test completed successfully")
                self.model_loaded = True
            except Exception as e:
                raise RuntimeError(f"Model test failed: {str(e)}")

    async def chat(self, prompt, model=None):
        if not self.is_initialized:
            raise RuntimeError("Ollama service is not initialized. Please wait for initialization to complete.")

        if model is None:
            model = self.default_model

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": model, "prompt": f"{self.get_system_prompt()}\n\nUser: {prompt}", "stream": False},
                    timeout=60,
                )
                response.raise_for_status()
                result = response.json()

                if "response" in result:
                    return {"response": result["response"]}
                else:
                    raise ValueError("Unexpected response format from Ollama")

            except httpx.RequestError as e:
                print(f"Request error during chat: {str(e)}")
                raise RuntimeError(f"Failed to get response from Ollama: {str(e)}")
            except ValueError as e:
                print(f"Value error during chat: {str(e)}")
                raise RuntimeError(f"Invalid response format from Ollama: {str(e)}")

    def get_system_prompt(self):
        return (
            "You are a NASA instructor providing clear, concise information about space exploration and science.\n"
            "Your responses should be:\n"
            "- Brief and to the point (2-3 sentences for general responses)\n"
            "- Professional and factual\n"
            "- Free of roleplay elements or emotive actions\n"
            "- Focused on accurate scientific information\n"
            "- Written in a clear, straightforward style\n\n"
            "If the user asks a specific technical question, you may provide more detailed information, "
            "but keep general responses concise."
        )

    async def list_models(self):
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(f"{self.base_url}/api/tags", timeout=5)
                response.raise_for_status()
                return {"status": "ready", "models": response.json().get("models", [])}
            except httpx.RequestError:
                return {"status": "error", "models": []}

    async def get_status(self):
        return {
            "initialized": self.is_initialized,
            "status": self.initialization_status.value,
            "model": self.default_model,
            "error": self.initialization_error
        }

# FastAPI app to expose endpoints for OllamaService
app = FastAPI()
ollama_service = OllamaService()

@app.on_event("startup")
async def startup_event():
    print("Starting Ollama service initialization...")
    try:
        await ollama_service.initialize()
    except Exception as e:
        print(f"Initialization failed: {str(e)}")

class ChatRequest(BaseModel):
    prompt: str
    model: str = None

@app.post("/initialize")
async def initialize():
    try:
        await ollama_service.initialize()
        return {"status": "ready"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(request: ChatRequest):
    try:
        response = await ollama_service.chat(request.prompt, request.model)
        if not response or "response" not in response:
            raise HTTPException(
                status_code=500,
                detail="Invalid response format from Ollama service"
            )
        return response
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/list_models")
async def list_models():
    try:
        models = await ollama_service.list_models()
        return models
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status")
async def get_status():
    try:
        status = await ollama_service.get_status()
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Start FastAPI app
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PYTHON_SERVICE_PORT", 5000)))
