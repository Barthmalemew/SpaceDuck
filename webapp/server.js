/**
 * Main server application for the NASA Space Duck chatbot
 * Handles HTTP requests, serves static files, and manages communication with Ollama API
 * Implements error handling and server initialization checks
 */
const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.SERVER_PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Add rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);

// Configure Ollama service URL
const OLLAMA_SERVICE_URL = process.env.OLLAMA_SERVICE_URL || 'http://localhost:5000';

// Create axios instance for Ollama service
const ollamaClient = axios.create({ baseURL: OLLAMA_SERVICE_URL });

let pythonProcess = null;
let serverReady = false;

// Function to start the Python Ollama service
async function startOllamaService() {
    console.log('Starting Ollama service...');
    const pythonScript = path.join(__dirname, 'services', 'ollama.py');

    // Check if virtual environment exists, if not create it
    if (!fs.existsSync(path.join(__dirname, 'venv'))) {
        console.log('Creating Python virtual environment...');
        await new Promise((resolve, reject) => {
            const venvProcess = spawn('python', ['-m', 'venv', 'venv']);
            venvProcess.on('close', (code) => code === 0 ? resolve() : reject());
        });
        
        // Install requirements
        await new Promise((resolve, reject) => {
            const pipProcess = spawn(path.join(__dirname, 'venv', 'bin', 'pip'), ['install', '-r', 'requirements.txt']);
            pipProcess.on('close', (code) => code === 0 ? resolve() : reject());
        });
    }
    pythonProcess = spawn(path.join(__dirname, 'venv', 'bin', 'python'), [pythonScript], {
        stdio: 'pipe'
    });

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Ollama service: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Ollama service error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Ollama service exited with code ${code}`);
        if (code !== 0) {
            console.error('Ollama service crashed, attempting restart...');
            setTimeout(startOllamaService, 5000);
        }
    });

    // Wait for service to start
    await new Promise(resolve => setTimeout(resolve, 2000));
}

async function initializeServer() {
    try {
        // Start Ollama service first
        await startOllamaService();
        
        const response = await ollamaClient.get('/health');
        if (response.data.status === 'ready') {
            serverReady = true;
            console.log('Server initialization complete, ready to handle requests');
        }
    } catch (error) {
        console.error('Server initialization failed:', error);
        setTimeout(initializeServer, 5000); // Retry every 5 seconds
    }
}

// Middleware to check if server is ready
const checkServerReady = (req, res, next) => {
    if (!serverReady) {
        return res.status(503).json({
            error: 'Server is still initializing',
            details: 'Please wait a few moments and try again'
        });
    }
    next();
};

app.get('/api/random-question', checkServerReady, async (req, res) => {
    try {
        const response = await ollamaClient.get('/random-question');
        const question = response.data.question;
        res.json({ question });
    } catch (error) {
        console.error('Error getting random question:', error);
        res.status(500).json({
            error: 'Failed to get random question'
        });
    }
});

// Chat endpoint handler
// Processes incoming chat messages and returns AI responses
// Implements error handling for various failure scenarios
app.post('/api/chat', checkServerReady, async (req, res) => {
    try {
        const response = await ollamaClient.post('/chat', { message: req.body.message });
        const botResponse = response.data.response;
        res.json({ response: botResponse });
    } catch (error) {
        console.error('Chat error:', error);

        let statusCode = 500;
        let errorMessage = 'An unexpected error occurred';

        if (error.message.includes('too long')) {
            statusCode = 504;
            errorMessage = 'The request took too long to complete. Please try again.';
        } else if (error.message.includes('not running')) {
            statusCode = 503;
            errorMessage = 'The AI service is currently unavailable. Please try again later.';
        }

        res.status(statusCode).json({
            error: errorMessage,
            details: error.message
        });
    }
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    if (pythonProcess) {
        pythonProcess.kill();
    }
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
});

// Start server initialization
initializeServer().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});
