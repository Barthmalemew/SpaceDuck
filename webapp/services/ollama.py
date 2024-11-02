"""
Ollama Service
Simple microservice to handle Ollama API interactions
Direct conversion of the original Node.js implementation
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import requests
import subprocess
from typing import Optional
import lancedb
import aiohttp
import pathlib
import sys
from contextlib import asynccontextmanager

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = None

class OllamaService:
    def __init__(self):
        self.base_url = 'http://localhost:11434'
        self.default_model = 'llama2'
        self.is_initialized = False
        self.db = None
        self.table = None
        # Get the path to the services directory
        self.services_dir = pathlib.Path(__file__).parent
        # Go up one level to the webapp directory and then into data
        self.data_dir = self.services_dir.parent / 'data'

    async def initialize(self):
        if self.is_initialized:
            return

        try:
            print('Initializing Ollama service...')
            print(f'Using data directory: {self.data_dir}')

            # Check if Ollama is running
            self.check_ollama_running()

            # Initialize LanceDB with correct path
            self.db = lancedb.connect(str(self.data_dir))
            self.table = self.db.open_table('space_training')

            # Check if model exists
            models = self.list_models()
            if not any(m['name'] == self.default_model for m in models):
                print(f'Default model {self.default_model} not found, downloading...')
                self.pull_model(self.default_model)

            self.is_initialized = True
            print('Ollama service initialization complete')

        except Exception as e:
            print(f'Failed to initialize Ollama service: {str(e)}')
            sys.stdout.flush()
            raise 
        
    def check_ollama_running(self):
        try:
            response = requests.get(f'{self.base_url}/api/tags', timeout=5)
            if response.status_code != 200:
                print(f"Ollama service returned status code: {response.status_code}")
                sys.stdout.flush()
                raise Exception('Ollama service returned unexpected status code')
            print("Successfully connected to Ollama service")
            sys.stdout.flush()
            return True
        except requests.RequestException as e:
            raise Exception('Ollama service is not running. Please start Ollama first.')

    def pull_model(self, model: str):
        try:
            print(f'Starting to pull model {model}. This may take several minutes...')
            sys.stdout.flush()
            result = subprocess.run(
                ['ollama', 'pull', model],
                capture_output=True,
                text=True,
                timeout=600
            )
            return True
        except subprocess.SubprocessError as e:
            raise Exception(f'Failed to pull model {model}: {str(e)}')

    async def chat(self, prompt: str, model: Optional[str] = None):
        if not self.is_initialized:
            raise Exception('Ollama service is not initialized')

        if not prompt or len(prompt.strip()) == 0:
            raise HTTPException(status_code=400, detail="Empty prompt provided")

        model = model or self.default_model

        # Add timeout handling
        timeout = aiohttp.ClientTimeout(total=60)

        try:
            # Search for relevant context in LanceDB
            search_results = self.table.search(prompt).limit(3).to_list()
            context = '\n'.join(r['text'] for r in search_results)

            # Generate response from Ollama
            response = requests.post(
                f'{self.base_url}/api/generate',
                json={
                    'model': model,
                    'prompt': f'{self.get_system_prompt()}\n\nContext:\n{context}\n\nUser: {prompt}',
                    'stream': False
                },
                timeout=60
            )

            response.raise_for_status()
            return response.json()

        except Exception as e:
            raise Exception(f'Failed to get response from Ollama: {str(e)}')

    def get_system_prompt(self):
        return """You are a NASA instructor providing clear, concise information about space exploration and science. 
        Your responses should be:
        - Brief and to the point (2-3 sentences for general responses)
        - Use the provided context to answer questions when relevant
        - Cite specific facts from the context when possible
        - Professional and factual
        - Free of roleplay elements or emotive actions
        - Focused on accurate scientific information
        - Written in a clear, straightforward style"""

    def list_models(self):
        try:
            response = requests.get(f'{self.base_url}/api/tags', timeout=5)
            if response.status_code != 200:
                print(f"Ollama service returned status code: {response.status_code}")
                sys.stdout.flush()
                raise Exception('Ollama service returned unexpected status code')
            return response.json().get('models', [])
        except requests.RequestException:
            return []

    async def get_random_question(self):
        if not self.table:
            return 'What interests you about space?'

        try:
            result = self.table.search("space question").limit(1).to_list()
            return result[0].text if result else 'What do you know about space exploration?'
        except Exception as e:
            print('Failed to get random question:', e)
            sys.stdout.flush()
            return 'What interests you about space?'

# Create singleton instance
service = OllamaService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        await service.initialize()
    except Exception as e:
        print(f"Startup error: {e}")
    yield
    # Shutdown
    if service.db:
        service.db.close()
    print("Shutting down Ollama service...")
    sys.stdout.flush()

# Add lifespan to FastAPI app
app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health_check():
    return {"status": "ready" if service.is_initialized else "initializing"}

@app.get("/random-question")
async def get_random_question():
    question = await service.get_random_question()
    return {"question": question}

@app.post("/chat")
async def chat(request: ChatRequest):
    if not request.message or len(request.message.strip()) == 0:
        raise HTTPException(status_code=400, detail="Empty message provided")

    response = await service.chat(request.message, request.model)
    return response

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
