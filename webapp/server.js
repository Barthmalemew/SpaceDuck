// This is the main server for Space Duck. It:
// 1. Handles all communication between the webpage and the AI
// 2. Manages the question database
// 3. Makes sure we don't overload our services
// 4. Handles errors gracefully

const express = require('express');
const path = require('path');
const axios = require('axios');
// Set up our database connection - we're using SQLite for practice questions
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, 'db', 'questions.db'));
// Load our environment variables from .env file
require('dotenv').config();

// Set up our web server
const app = express();
const PORT = process.env.SERVER_PORT || 3000;  // Use port from settings or default to 3000
let httpServer = null;

// Tell Express how to handle different types of requests
app.use(express.json());  // For handling JSON data
app.use(express.static(path.join(__dirname, 'public')));  // For serving our webpage files
app.use(express.urlencoded({ extended: true }));  // For handling form submissions

// Set up rate limiting to prevent overload
// This makes sure no one can spam our server with too many requests
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // Time window: 15 minutes
    max: 100                    // Max 100 requests per window per IP
});
app.use('/api/', limiter);

// Set up connection to our AI service
const OLLAMA_SERVICE_URL = process.env.OLLAMA_SERVICE_URL || 'http://localhost:5000';
const ollamaClient = axios.create({ baseURL: OLLAMA_SERVICE_URL });

// Track server status
let serverReady = false;
let initializationError = null;
const MAX_INIT_RETRIES = 5;
let initRetryCount = 0;

// This function gets everything ready to handle requests
async function initializeServer() {
    try {
        // Check if our AI service is ready
        const statusResponse = await ollamaClient.get('/status');
        console.log('Ollama service status:', statusResponse.data);

        // If it's not ready, try to initialize it
        if (statusResponse.data.status !== 'ready') {
            const initResponse = await ollamaClient.post('/initialize');
            if (!initResponse.data.status === 'success') throw new Error('Initialization failed');
        }

        serverReady = true;
        initializationError = null;
        console.log('Server initialization complete, ready to handle requests');
    } catch (error) {
        // If something goes wrong, try again a few times
        initRetryCount++;
        initializationError = error.response?.data?.error || error.message;
        console.error(`Initialization attempt ${initRetryCount}/${MAX_INIT_RETRIES} failed:`, initializationError);

        if (initRetryCount < MAX_INIT_RETRIES) {
            // Wait longer between each retry (but not more than 30 seconds)
            const retryDelay = Math.min(5000 * Math.pow(2, initRetryCount - 1), 30000);
            console.log(`Retrying initialization in ${retryDelay/1000} seconds...`);
            setTimeout(initializeServer, retryDelay);
        } else {
            console.error('Max initialization retries reached. Server starting in limited mode.');
            serverReady = false;
        }
    }
}

// Check if server is ready before handling requests
const checkServerReady = (req, res, next) => {
    if (!serverReady) {
        return res.status(503).json({
            error: 'Server is still initializing',
            details: initializationError || 'Please wait a few moments and try again'
        });
    }
    next();
};

// Set up question caching to improve performance
const questionCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;  // Cache questions for 5 minutes

// API endpoint: Get a question from a specific category
app.get('/api/questions/:category', async (req, res) => {
    try {
        const category = req.params.category;
        const cacheKey = `category_${category}`;

        // Check if we have a cached question for this category
        const cachedData = questionCache.get(cacheKey);
        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
            return res.json(cachedData.data);
        }

        // If no cached question, get a random one from the database
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
                // Cache the question and send it back
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

// API endpoint: Get all available question categories
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

// API endpoint: Get a completely random question
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

// API endpoint: Chat with Space Duck
app.post('/api/chat', checkServerReady, async (req, res) => {
    try {
        // Send the user's message to our AI service
        const response = await ollamaClient.post('/chat', { prompt: req.body.message });
        const botResponse = response.data.response || response.data.text;

        // Make sure we got a response
        if (!botResponse) {
            throw new Error('Empty response received from Ollama service');
        }

        res.json({ response: botResponse });
    } catch (error) {
        console.error('Detailed chat error:', error.response?.data || error.message);
        let statusCode = 500;
        let errorMessage = 'An unexpected error occurred';

        // Provide helpful error messages for common problems
        if (error.message.includes('too long')) {
            statusCode = 504;
            errorMessage = 'The request took too long to complete. Please try again.';
        } else if (error.message.includes('not running')) {
            statusCode = 503;
            errorMessage = 'The model is currently unavailable. Please try again later.';
        }

        res.status(statusCode).json({
            error: errorMessage,
            details: error.message
        });
    }
});

// Handle shutting down gracefully
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    if (httpServer) httpServer.close();
    process.exit(0);
});

// Handle unexpected errors gracefully
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Start everything up
initializeServer().then(() => {
    httpServer = app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});