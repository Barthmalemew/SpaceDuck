/**
 * Main server application for the NASA Space Duck chatbot
 * Handles HTTP requests, serves static files, and manages communication with Ollama API
 * Implements error handling and server initialization checks
 */
const express = require('express');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, 'db', 'questions.db'));
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
const ollamaClient = axios.create({ baseURL: OLLAMA_SERVICE_URL });

let serverReady = false;
let initializationError = null;
const MAX_INIT_RETRIES = 5;
let initRetryCount = 0;

//This function checks to see if the server is initalized
async function initializeServer() {
    try {
        const statusResponse = await ollamaClient.get('/status');

        if (!statusResponse.data.initialized) {
            console.log(`Initializing Ollama service (Status: ${statusResponse.data.status})...`);
            await ollamaClient.post('/initialize');
        }

        serverReady = true;
        initializationError = null;
        console.log('Server initialization complete, ready to handle requests');
    } catch (error) {
        initRetryCount++;
        initializationError = error.response?.data?.error || error.message;
        console.error(`Initialization attempt ${initRetryCount} failed:`, initializationError);

        if (initRetryCount < MAX_INIT_RETRIES) {
            console.log(`Retrying initialization in 5 seconds...`);
            setTimeout(initializeServer, 5000);
        } else {
            console.error('Max initialization retries reached. Server starting in limited mode.');
            serverReady = false;
        }
    }
}

// Middleware to check if server is ready
const checkServerReady = (req, res, next) => {
    if (!serverReady) {
        return res.status(503).json({
            error: 'Server is still initializing',
            details: initializationError || 'Please wait a few moments and try again'
        });
    }
    next();
};

// Enhanced questions endpoint with error handling and caching
const questionCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

app.get('/api/questions/:category', async (req, res) => {
    try {
        //
        const category = req.params.category;
        const cacheKey = `category_${category}`;
        const cachedData = questionCache.get(cacheKey);
        
        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
            return res.json(cachedData.data);
        }

        db.get(
            'SELECT * FROM questions WHERE category = ? ORDER BY RANDOM() LIMIT 1',
            [category],
            (err, row) => {
                if (err) throw err;
                if (!row) {
                    return res.status(404).json({ 
                        error: 'No questions found for this category' 
                    });
                }
                questionCache.set(cacheKey, {
                    data: row,
                    timestamp: Date.now()
                });
                res.json(row);
            });
    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({
            error: 'Failed to fetch questions',
            details: error.message
        });
    }
});

// New endpoint to get categories
app.get('/api/categories', async (req, res) => {
    try {
        db.all(
            'SELECT DISTINCT category FROM questions',
            [],
            (err, rows) => {
                if (err) throw err;
                res.json(rows.map(row => row.category));
            }
        );
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            error: 'Failed to fetch categories',
            details: error.message
        });
    }
});

// New endpoint to get random question
app.get('/api/random-question', async (req, res) => {
    try {
        db.get(
            'SELECT * FROM questions ORDER BY RANDOM() LIMIT 1',
            [],
            (err, row) => {
                if (err) throw err;
                res.json(row);
            }
        );
    } catch (error) {
        console.error('Error fetching random question:', error);
        res.status(500).json({
            error: 'Failed to fetch random question',
            details: error.message
        });
    }
});

// Chat endpoint handler
// Processes incoming chat messages and returns AI responses
// Implements error handling for various failure scenarios
app.post('/api/chat', checkServerReady, async (req, res) => {
    try {
        const response = await ollamaClient.post('/chat', { prompt: req.body.message });
        const botResponse = response.data.response || response.data.text;
        if (!botResponse) {
            throw new Error('Empty response received from Ollama service');
        }
        res.json({ response: botResponse });
    } catch (error) {
        console.error('Detailed chat error:', error.response?.data || error.message);
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
    // Clean shutdown of Express server
    server.close();
    process.exit(0);
});

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Attempt graceful shutdown
    process.exit(1);
});

// Start server initialization
initializeServer().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});
