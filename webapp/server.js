/**
 * Main server application for the NASA Space Duck chatbot
 * Handles HTTP requests, serves static files, and manages communication with Ollama API
 * Implements error handling and server initialization checks
 */
const express = require('express');
const path = require('path');
const ollamaService = require('./services/ollama');

const app = express();
const PORT = process.env.SERVER_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Ollama before accepting requests
let serverReady = false;

async function initializeServer() {
    try {
        // Attempt to initialize the Ollama service
        // This includes:
        // - Checking if Ollama is running
        // - Verifying model availability
        // - Setting up initial configuration
        await ollamaService.initialize();
        serverReady = true;
        console.log('Server initialization complete, ready to handle requests');
    } catch (error) {
        console.error('Server initialization failed:', error);
        process.exit(1); // Exit if initialization fails
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

// Chat endpoint handler
// Processes incoming chat messages and returns AI responses
// Implements error handling for various failure scenarios
app.post('/api/chat', checkServerReady, async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({
            error: 'Message is required',
            details: 'Please provide a message to chat with the AI.'
        });
    }

    try {
        const response = await ollamaService.chat(message);

        const botResponse = response.response ||
            response.message ||
            response.content ||
            'I apologize, but I was unable to generate a response.';

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

// Start server initialization
initializeServer().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});
