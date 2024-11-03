# llama_index_service.py
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core.llms import LLM
from llama_index.core.llms import ChatMessage, CompletionResponse, LLMMetadata
from llama_index.core.node_parser import SentenceSplitter, SimpleNodeParser
from typing import Optional, List, Mapping, Any, Sequence, AsyncGenerator, Generator
import httpx
import os
import json
import asyncio
from pathlib import Path

class OllamaLLM(LLM):
    """Ollama LLM implementation with proper async support and error handling."""

    base_url: str = "http://localhost:11434"
    model: str = "llama2"
    timeout: int = 60

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._client = httpx.AsyncClient(timeout=self.timeout)
        self._validate_config()

    def _validate_config(self):
        """Validate the configuration settings."""
        if not self.base_url:
            raise ValueError("base_url must be specified")
        if not self.model:
            raise ValueError("model must be specified")

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._client.aclose()

    @property
    def metadata(self) -> LLMMetadata:
        return LLMMetadata(
            model_name=self.model,
            context_window=4096,
            model_type="ollama"
        )

    async def acomplete(self, prompt: str, **kwargs) -> List[str]:
        """Complete the prompt asynchronously."""
        try:
            response = await self._client.post(
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt},
                timeout=self.timeout
            )
            response.raise_for_status()
            return [response.json()["response"]]
        except Exception as e:
            print(f"Error in OllamaLLM acomplete: {str(e)}")
            return [""]

    async def achat(self, messages: Sequence[ChatMessage], **kwargs) -> str:
        """Process chat messages asynchronously."""
        try:
            formatted_messages = []
            for msg in messages:
                # Use the role directly from the ChatMessage
                formatted_messages.append(f"{msg.role}: {msg.content}")

            prompt = "\n".join(formatted_messages)
            responses = await self.acomplete(prompt, **kwargs)
            return responses[0] if responses else ""
        except Exception as e:
            print(f"Error in OllamaLLM achat: {str(e)}")
            return ""

    async def astream_chat(
        self, messages: Sequence[ChatMessage], **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream chat responses asynchronously."""
        try:
            formatted_messages = []
            for msg in messages:
                formatted_messages.append(f"{msg.role}: {msg.content}")
            prompt = "\n".join(formatted_messages)
            
            async for response in self.astream_complete(prompt, **kwargs):
                yield response
        except Exception as e:
            print(f"Error in astream_chat: {str(e)}")
            yield ""

    async def astream_complete(
        self, prompt: str, **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream completion responses asynchronously."""
        try:
            response = await self._client.post(
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": True},
                timeout=self.timeout
            )
            response.raise_for_status()
            
            async for line in response.aiter_lines():
                if line.strip():
                    data = json.loads(line)
                    if "response" in data:
                        yield data["response"]
        except Exception as e:
            print(f"Error in astream_complete: {str(e)}")
            yield ""

    def complete(self, prompt: str, **kwargs) -> List[str]:
        """Synchronous complete method that uses the async version."""
        return asyncio.run(self.acomplete(prompt, **kwargs))

    def chat(self, messages: Sequence[ChatMessage], **kwargs) -> str:
        """Synchronous chat method that uses the async version."""
        return asyncio.run(self.achat(messages, **kwargs))

    def stream_chat(
        self, messages: Sequence[ChatMessage], **kwargs
    ) -> Generator[str, None, None]:
        """Synchronous version of stream_chat."""
        async def async_generator():
            async for response in self.astream_chat(messages, **kwargs):
                yield response

        return async_to_sync_generator(async_generator())

    def stream_complete(
        self, prompt: str, **kwargs
    ) -> Generator[str, None, None]:
        """Synchronous version of stream_complete."""
        async def async_generator():
            async for response in self.astream_complete(prompt, **kwargs):
                yield response

        return async_to_sync_generator(async_generator())

def async_to_sync_generator(async_gen):
    """Helper function to convert async generator to sync generator."""
    loop = asyncio.new_event_loop()
    try:
        while True:
            try:
                yield loop.run_until_complete(async_gen.__anext__())
            except StopAsyncIteration:
                break
    finally:
        loop.close()

class LlamaIndexService:
    """Service for managing document indexing and querying using LlamaIndex."""

    def __init__(
            self,
            docs_dir: str = "data/nasa_docs",
            model: str = "llama2",
            embed_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    ):
        # Get the current file's directory and resolve the docs_dir path relative to it
        current_dir = Path(__file__).parent
        self.docs_dir = current_dir / docs_dir
        self.model = model
        self.llm = OllamaLLM(model=model)
        self.embed_model = None
        self.index = None
        self.embed_model_name = embed_model_name
        # Debug logging
        print(f"Current directory: {current_dir}")
        print(f"Initializing LlamaIndex with documents from: {self.docs_dir}")

    async def initialize(self):
        """Initialize the service and create necessary components."""
        try:
            # Debug: Print absolute path
            print(f"Absolute docs path: {self.docs_dir.absolute()}")
            
            # Verify documents directory exists and contains files
            if not self.docs_dir.exists():
                raise RuntimeError(f"Documents directory not found: {self.docs_dir}")

            doc_files = list(self.docs_dir.glob('*.txt'))
            print(f"Found {len(doc_files)} document files")

            # Initialize LLM and embedding model
            self.embed_model = HuggingFaceEmbedding(
                model_name=self.embed_model_name,
                embed_batch_size=4
            )

            # Configure Settings
            Settings.llm = self.llm
            Settings.embed_model = self.embed_model
            Settings.node_parser = SimpleNodeParser.from_defaults(
                chunk_size=512,
                chunk_overlap=50
            )

            # Load and index documents
            if any(self.docs_dir.iterdir()):
                documents = SimpleDirectoryReader(str(self.docs_dir)).load_data()
                print(f"Loading {len(documents)} documents...")
                self.index = VectorStoreIndex.from_documents(
                    documents
                )
                print(f"Indexed {len(documents)} documents from {self.docs_dir}")
            else:
                print(f"No documents found in {self.docs_dir}")
                raise RuntimeError("No documents found in specified directory")

            print("LlamaIndex initialization complete")
            return True

        except Exception as e:
            print(f"Error initializing LlamaIndex service: {str(e)}")
            raise

    async def query(self, query_text: str, similarity_top_k: int = 3) -> str:
        """Query the index with proper error handling."""
        if not self.index:
            print("Error: Index not initialized")
            raise RuntimeError("Index not initialized")

        try:
            query_engine = self.index.as_query_engine(
                similarity_top_k=similarity_top_k
            )
            response = await query_engine.aquery(query_text)
            return str(response)
        except Exception as e:
            print(f"Error in query: {str(e)}")
            return f"Error processing query: {str(e)}"

    async def refresh_index(self) -> str:
        """Refresh the document index."""
        try:
            await self.initialize()
            return "Index refreshed successfully"
        except Exception as e:
            return f"Error refreshing index: {str(e)}"

# ollama.py content remains the same as in the previous version
# ollama.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from enum import Enum
from typing import Optional, Dict, Any
import os
from dotenv import load_dotenv

load_dotenv()

class InitializationState(Enum):
    NOT_STARTED = "not_started"
    INITIALIZING = "initializing"
    READY = "ready"
    FAILED = "failed"

class OllamaService:
    """Main service coordinating Ollama and LlamaIndex functionality."""

    def __init__(self):
        self.base_url = os.getenv("OLLAMA_API_HOST", "http://localhost:11434")
        self.default_model = os.getenv("OLLAMA_DEFAULT_MODEL", "llama2")
        self.initialization_state = InitializationState.NOT_STARTED
        self.initialization_error = None
        self.llama_index = LlamaIndexService(model=self.default_model)
        self._client = httpx.AsyncClient(timeout=30)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._client.aclose()

    async def initialize(self):
        """Initialize both Ollama and LlamaIndex services."""
        if self.initialization_state == InitializationState.READY:
            return

        self.initialization_state = InitializationState.INITIALIZING
        try:
            # Check if Ollama is running
            await self._check_ollama_service()

            # Initialize LlamaIndex
            await self.llama_index.initialize()

            self.initialization_state = InitializationState.READY
            self.initialization_error = None
            print("Ollama service initialization complete")

        except Exception as e:
            self.initialization_state = InitializationState.FAILED
            self.initialization_error = str(e)
            print(f"Initialization failed: {str(e)}")
            raise

    async def _check_ollama_service(self):
        """Verify Ollama service is running and model is available."""
        try:
            response = await self._client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()

            models = response.json().get("models", [])
            if not any(model["name"] == self.default_model for model in models):
                print(f"Downloading model {self.default_model}...")
                await self._pull_model()

        except Exception as e:
            raise RuntimeError(f"Ollama service check failed: {str(e)}")

    async def _pull_model(self):
        """Pull the specified model from Ollama."""
        try:
            response = await self._client.post(
                f"{self.base_url}/api/pull",
                json={"name": self.default_model}
            )
            response.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"Failed to pull model: {str(e)}")

    async def chat(self, prompt: str, model: Optional[str] = None) -> Dict[str, str]:
        """Handle chat requests using both LlamaIndex and direct Ollama if needed."""
        if self.initialization_state != InitializationState.READY:
            raise RuntimeError("Service not initialized")

        try:
            # First try LlamaIndex for context-aware responses
            index_response = await self.llama_index.query(prompt)
            if index_response and not index_response.startswith("Error"):
                return {"response": index_response}

            # Fallback to direct Ollama chat
            response = await self._client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": model or self.default_model,
                    "prompt": f"{self._get_system_prompt()}\n\nUser: {prompt}",
                    "stream": False
                }
            )
            response.raise_for_status()
            return {"response": response.json()["response"]}

        except Exception as e:
            raise RuntimeError(f"Chat failed: {str(e)}")

    def _get_system_prompt(self) -> str:
        """Get the system prompt for NASA-specific responses."""
        return (
            "You are a NASA instructor providing clear, concise information about "
            "space exploration and science.\n"
            "Your responses should be:\n"
            "- Brief and to the point (2-3 sentences for general responses)\n"
            "- Professional and factual\n"
            "- Focused on accurate scientific information\n"
            "- Written in a clear, straightforward style"
        )

app = FastAPI()
ollama_service = OllamaService()

@app.on_event("startup")
async def startup_event():
    print("Starting Ollama service initialization...")
    await ollama_service.initialize()

class ChatRequest(BaseModel):
    prompt: str
    model: Optional[str] = None

@app.post("/chat")
async def chat(request: ChatRequest):
    try:
        response = await ollama_service.chat(request.prompt, request.model)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status")
async def get_status():
    return {
        "status": ollama_service.initialization_state.value,
        "error": ollama_service.initialization_error,
        "model": ollama_service.default_model
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PYTHON_SERVICE_PORT", 5000))
    uvicorn.run(app, host="0.0.0.0", port=port)
