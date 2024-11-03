# NASA Space Duck LLM Service
# This is the backend service that powers the Space Duck chatbot. It:
# 1. Connects to a local Ollama service that runs the AI model
# 2. Indexes and searches through NASA documents
# 3. Handles all the error cases and retries

from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core.llms import LLM, ChatMessage, CompletionResponse, LLMMetadata
from llama_index.core.node_parser import SimpleNodeParser
from typing import Optional, List, Sequence, AsyncGenerator, Generator
import httpx
import json
import asyncio
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from enum import Enum
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# These are the possible states of our service
class InitializationState(Enum):
    NOT_STARTED = "not_started"    # Just started up
    INITIALIZING = "initializing"  # Loading models and documents
    READY = "ready"               # Ready to handle requests
    FAILED = "failed"             # Something went wrong

# This helper converts async code (which can run in parallel) to sync code (which runs one at a time)
def async_to_sync_generator(async_gen):
    loop = asyncio.new_event_loop()
    try:
        while True:
            try:
                yield loop.run_until_complete(async_gen.__anext__())
            except StopAsyncIteration:
                break
    finally:
        loop.close()

# This class handles all communication with the Ollama AI service
class OllamaLLM(LLM):
    # Default settings for connecting to Ollama
    base_url: str = "http://localhost:11434"  # Where Ollama is running
    model: str = "llama2"                     # Which AI model to use
    timeout: int = 60                         # How long to wait for responses

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Set up a client for making HTTP requests to Ollama
        self._client = httpx.AsyncClient(timeout=self.timeout)
        self._validate_config()

    def _validate_config(self):
        # Make sure we have the minimum required settings
        if not self.base_url:
            raise ValueError("base_url must be specified")
        if not self.model:
            raise ValueError("model must be specified")

    # Clean up when we're done
    async def __aenter__(self): return self
    async def __aexit__(self, *_): await self._client.aclose()

    @property
    def metadata(self) -> LLMMetadata:
        # Tell LlamaIndex about our model's capabilities
        return LLMMetadata(
            model_name=self.model,
            context_window=4096,  # How much text it can handle at once
            model_type="ollama"
        )

    async def acomplete(self, prompt: str, **kwargs) -> List[str]:
        # Send a prompt to Ollama and get a response
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
        # Handle back-and-forth chat messages
        try:
            # Format the messages like "user: hello" and "assistant: hi"
            formatted_messages = [f"{msg.role}: {msg.content}" for msg in messages]
            prompt = "\n".join(formatted_messages)
            responses = await self.acomplete(prompt, **kwargs)
            return responses[0] if responses else ""
        except Exception as e:
            print(f"Error in OllamaLLM achat: {str(e)}")
            return ""

    # The following methods are required by LlamaIndex but we don't really use them
    # They're just here to make the interface complete
    async def astream_chat(self, messages: Sequence[ChatMessage], **kwargs) -> AsyncGenerator[str, None]:
        try:
            formatted_messages = [f"{msg.role}: {msg.content}" for msg in messages]
            prompt = "\n".join(formatted_messages)
            async for response in self.astream_complete(prompt, **kwargs):
                yield response
        except Exception as e:
            print(f"Error in astream_chat: {str(e)}")
            yield ""

    async def astream_complete(self, prompt: str, **kwargs) -> AsyncGenerator[str, None]:
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
        return asyncio.run(self.acomplete(prompt, **kwargs))

    def chat(self, messages: Sequence[ChatMessage], **kwargs) -> str:
        return asyncio.run(self.achat(messages, **kwargs))

    def stream_chat(self, messages: Sequence[ChatMessage], **kwargs) -> Generator[str, None, None]:
        async def async_generator():
            async for response in self.astream_chat(messages, **kwargs):
                yield response
        return async_to_sync_generator(async_generator())

    def stream_complete(self, prompt: str, **kwargs) -> Generator[str, None, None]:
        async def async_generator():
            async for response in self.astream_complete(prompt, **kwargs):
                yield response
        return async_to_sync_generator(async_generator())

# This service handles all the NASA documents - loading them, indexing them, and searching through them
class LlamaIndexService:
    def __init__(self, docs_dir: str = "data/nasa_docs", model: str = "llama2"):
        # Figure out where our documents are stored
        current_dir = Path(__file__).parent
        self.docs_dir = current_dir / docs_dir
        self.model = model
        self.llm = OllamaLLM(model=model)
        self.embed_model = None
        self.index = None

        # Log what we're doing for debugging
        print(f"Current directory: {current_dir}")
        print(f"Loading NASA docs from: {self.docs_dir}")

    async def initialize(self):
        try:
            print(f"Looking for docs in: {self.docs_dir.absolute()}")

            # Make sure our docs directory exists
            if not self.docs_dir.exists():
                raise RuntimeError(f"Can't find documents directory: {self.docs_dir}")

            # Count how many documents we found
            doc_files = list(self.docs_dir.glob('*.txt'))
            print(f"Found {len(doc_files)} document files")

            # Set up the embedding model for searching
            self.embed_model = HuggingFaceEmbedding(
                model_name="sentence-transformers/all-MiniLM-L6-v2",
                embed_batch_size=4
            )

            # Configure everything
            Settings.llm = self.llm
            Settings.embed_model = self.embed_model
            Settings.node_parser = SimpleNodeParser.from_defaults(
                chunk_size=512,
                chunk_overlap=50
            )

            # Load and index all the documents
            if any(self.docs_dir.iterdir()):
                documents = SimpleDirectoryReader(str(self.docs_dir)).load_data()
                print(f"Loading {len(documents)} documents...")
                self.index = VectorStoreIndex.from_documents(documents)
                print(f"Successfully indexed documents")
            else:
                raise RuntimeError("No documents found to index")

            return True
        except Exception as e:
            print(f"Something went wrong during initialization: {str(e)}")
            raise

    async def query(self, query_text: str, similarity_top_k: int = 3) -> str:
        # Search through the documents to answer a question
        if not self.index:
            raise RuntimeError("Need to initialize before querying")

        try:
            query_engine = self.index.as_query_engine(similarity_top_k=similarity_top_k)
            response = await query_engine.aquery(query_text)
            return str(response)
        except Exception as e:
            print(f"Error during query: {str(e)}")
            return f"Error processing query: {str(e)}"

# The main service that coordinates everything
class OllamaService:
    def __init__(self):
        # Get settings from environment variables
        self.base_url = os.getenv("OLLAMA_API_HOST", "http://localhost:11434")
        self.default_model = os.getenv("OLLAMA_DEFAULT_MODEL", "llama2")
        self.initialization_state = InitializationState.NOT_STARTED
        self.initialization_error = None
        self.llama_index = LlamaIndexService(model=self.default_model)
        self._client = httpx.AsyncClient(timeout=30)

    async def __aenter__(self): return self
    async def __aexit__(self, *_): await self._client.aclose()

    async def initialize(self):
        # Skip if we're already initialized
        if self.initialization_state == InitializationState.READY:
            return

        self.initialization_state = InitializationState.INITIALIZING
        try:
            # Make sure Ollama is running and has our model
            await self._check_ollama_service()
            # Initialize document search
            await self.llama_index.initialize()

            self.initialization_state = InitializationState.READY
            self.initialization_error = None
            print("Ready to handle requests!")
        except Exception as e:
            self.initialization_state = InitializationState.FAILED
            self.initialization_error = str(e)
            print(f"Initialization failed: {str(e)}")
            raise

    async def _check_ollama_service(self):
        try:
            # Check what models Ollama has available
            response = await self._client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()

            # Download our model if it's not already there
            models = response.json().get("models", [])
            if not any(model["name"] == self.default_model for model in models):
                print(f"Downloading {self.default_model}...")
                await self._pull_model()
        except Exception as e:
            raise RuntimeError(f"Couldn't connect to Ollama: {str(e)}")

    async def _pull_model(self):
        try:
            response = await self._client.post(
                f"{self.base_url}/api/pull",
                json={"name": self.default_model}
            )
            response.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"Couldn't download model: {str(e)}")

    async def chat(self, prompt: str, model: Optional[str] = None) -> dict:
        # Make sure we're ready to handle requests
        if self.initialization_state != InitializationState.READY:
            raise RuntimeError("Not ready yet - still initializing")

        try:
            # First try to answer from our NASA documents
            index_response = await self.llama_index.query(prompt)
            if index_response and not index_response.startswith("Error"):
                return {"response": index_response}

            # If we can't find an answer in the docs, ask the AI directly
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
        # Tell the AI how to behave
        return (
            "You are a NASA instructor providing clear, concise information about "
            "space exploration and science.\n"
            "Your responses should be:\n"
            "- Brief and to the point (2-3 sentences for general responses)\n"
            "- Professional and factual\n"
            "- Focused on accurate scientific information\n"
            "- Written in a clear, straightforward style"
        )

# Set up the web API
app = FastAPI()
ollama_service = OllamaService()

# Initialize when the server starts
@app.on_event("startup")
async def startup_event():
    print("Starting up...")
    await ollama_service.initialize()

# This defines what a chat request looks like
class ChatRequest(BaseModel):
    prompt: str
    model: Optional[str] = None

# API endpoint for chat
@app.post("/chat")
async def chat(request: ChatRequest):
    try:
        return await ollama_service.chat(request.prompt, request.model)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# API endpoint to check if we're ready
@app.get("/status")
async def get_status():
    return {
        "status": ollama_service.initialization_state.value,
        "error": ollama_service.initialization_error,
        "model": ollama_service.default_model
    }

# API endpoint to manually trigger initialization
@app.post("/initialize")
async def initialize_service():
    try:
        await ollama_service.initialize()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500,
                            detail=f"Initialization failed: {str(e)}")

# Start the server if we're running this file directly
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PYTHON_SERVICE_PORT", 5000))
    uvicorn.run(app, host="0.0.0.0", port=port)