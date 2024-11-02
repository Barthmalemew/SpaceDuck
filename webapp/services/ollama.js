const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
require('dotenv').config();

class OllamaService {
    constructor() {
        this.baseUrl = process.env.OLLAMA_API_HOST || 'http://localhost:11434';
        this.defaultModel = process.env.OLLAMA_DEFAULT_MODEL || 'llama2';
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing Ollama service...');

            // Check if Ollama is running
            await this.checkOllamaRunning();

            // Check if model exists, download if needed
            const models = await this.listModels();
            if (!models.some(m => m.name === this.defaultModel)) {
                console.log(`Default model ${this.defaultModel} not found, downloading...`);
                await this.pullModel(this.defaultModel);
            } else {
                console.log(`Model ${this.defaultModel} is already downloaded`);
            }

            this.isInitialized = true;
            console.log('Ollama service initialization complete');
        } catch (error) {
            console.error('Failed to initialize Ollama service:', error);
            throw error;
        }
    }

    async checkOllamaRunning() {
        try {
            await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
            return true;
        } catch (error) {
            throw new Error('Ollama service is not running. Please start Ollama first.');
        }
    }

    async pullModel(model) {
        try {
            console.log(`Starting to pull model ${model}. This may take several minutes...`);

            const { stdout, stderr } = await execAsync(`ollama pull ${model}`, {
                timeout: 600000 // 10 minutes timeout for pulling
            });

            console.log(`Model ${model} pull completed:`, stdout);
            if (stderr) console.error(`Pull warnings:`, stderr);

            return true;
        } catch (error) {
            console.error(`Failed to pull model ${model}:`, error);
            throw new Error(`Failed to pull model ${model}: ${error.message}`);
        }
    }

    async chat(prompt, model = this.defaultModel) {
        if (!this.isInitialized) {
            throw new Error('Ollama service is not initialized. Please wait for initialization to complete.');
        }

        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model,
                prompt: `${this.getSystemPrompt()}\n\nUser: ${prompt}`,
                stream: false
            }, {
                timeout: 60000 // 60 second timeout for chat responses
            });

            return response.data;
        } catch (error) {
            console.error('Ollama chat error:', error);

            if (error.code === 'ECONNABORTED') {
                throw new Error('The request took too long to complete. Please try again.');
            } else if (error.response?.status === 404) {
                throw new Error('Ollama API endpoint not found. Please check if Ollama is running.');
            } else if (error.code === 'ECONNREFUSED') {
                throw new Error('Could not connect to Ollama. Please ensure Ollama is running.');
            }

            throw new Error(`Failed to get response from Ollama: ${error.message}`);
        }
    }

    getSystemPrompt() {
        const systemPrompt = `You are an experienced NASA instructor with extensive knowledge of space exploration, 
        astronaut training, and space science. You should:
        - Use precise, scientific terminology when appropriate
        - Provide real NASA mission examples to illustrate concepts
        - Share interesting space facts and current NASA developments
        - Maintain a professional but engaging teaching style
        - Correct any misconceptions about space science
        - Reference actual NASA training procedures when relevant`;
        return systemPrompt;
    }

    async listModels() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/tags`, {
                timeout: 5000
            });
            return response.data.models || [];
        } catch (error) {
            console.error('Failed to list models:', error);
            return [];
        }
    }
}

module.exports = new OllamaService();