const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class OllamaService {
    constructor() {
        this.baseUrl = 'http://localhost:11434';
    }

    async isInstalled() {
        try {
            const { stdout } = await execAsync('ollama --version');
            return stdout.includes('ollama');
        } catch (error) {
            return false;
        }
    }

    async chat(prompt, model = 'llama2') {
        try {
            const response = await axios.post(`${this.baseUrl}/api/generate`, {
                model,
                prompt,
                stream: false
            });
            return response.data;
        } catch (error) {
            console.error('Ollama chat error:', error);
            throw new Error('Failed to get response from Ollama');
        }
    }

    async listModels() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/tags`);
            return response.data.models || [];
        } catch (error) {
            console.error('Failed to list models:', error);
            return [];
        }
    }
}

module.exports = new OllamaService();
