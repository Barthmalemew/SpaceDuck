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
let httpServer = null;

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

async function initializeServer() {
    try {
        //this sends a get request for the status of the server and waits for a response
        const statusResponse = await ollamaClient.get('/status');
        console.log('Ollama service status:', statusResponse.data);

        if (statusResponse.data.status !== 'ready') {
            const initResponse = await ollamaClient.post('/initialize');
            if (!initResponse.data.status === 'success') throw new Error('Initialization failed');
        }

        serverReady = true;
        initializationError = null;
        console.log('Server initialization complete, ready to handle requests');
    } catch (error) {
        initRetryCount++;
        initializationError = error.response?.data?.error || error.message;
        console.error(`Initialization attempt ${initRetryCount}/${MAX_INIT_RETRIES} failed:`, initializationError);

        if (initRetryCount < MAX_INIT_RETRIES) {
            const retryDelay = Math.min(5000 * Math.pow(2, initRetryCount - 1), 30000);
            console.log(`Retrying initialization in ${retryDelay/1000} seconds...`);
            setTimeout(initializeServer, retryDelay);
        } else {
            console.error('Max initialization retries reached. Server starting in limited mode.');
            serverReady = false;
        }
    }
}

// Middleware to check if server is ready
const checkServerReady = (req, res, next) => {
    //if the server isnt ready it sends an error message detailing that
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
        //this is setting the const to the category 
        const category = req.params.category;
        //sets the value of cacheKey to a formatted string using the value of category
        const cacheKey = `category_${category}`;
        //sets the value of cachedData to the value in the questionCache map at the key cacheKey
        const cachedData = questionCache.get(cacheKey);
        
        //This is setting a "lifespan" for cached questions to make sure the map structure is "trimed" and
        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
            return res.json(cachedData.data);
        }
        //this sends a sql esq request to the database to select a single questiom randomly from the category provided
        db.get(
            'SELECT * FROM questions WHERE category = ? ORDER BY RANDOM() LIMIT 1',
            [category],
            //checks the error and row values to catch any potentional isssues
            (err, row) => {
                if (err) throw err;
                if (!row) {
                    return res.status(404).json({
                        error: 'No questions found for this category'
                    });
                }
                //puts the question, and the time it was stored in the questionCache map under the key cacheKey
                questionCache.set(cacheKey, {
                    data: row,
                    timestamp: Date.now()
                });
                //this responds to the call with the contents in the row variable in the format of a json file
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
        //selects the distinct categories from each question in the database to get all of the categories of questions without repeats
        db.all(
            'SELECT DISTINCT category FROM questions',
            [],
            (err, rows) => {
                if (err) throw err;
                //returns the categories as a json file where the rows are set to the categories retrieved from the query
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
//this gets a single random question without consideration of its category 
app.get('/api/random-question', async (req, res) => {
    try {
        //this sends a query to the database to get a random question
        db.get(
            'SELECT * FROM questions ORDER BY RANDOM() LIMIT 1',
            [],
            (err, row) => {
                if (err) throw err;
                //response to the request with the contents of the row variable in json format
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
    //trys to get a response from the model using the users input as the prompt
    try {
        //sets response to the response of the LLM Model to the prompt of the user input and wait till it arrives
        const response = await ollamaClient.post('/chat', { prompt: req.body.message });
        //This sets the bot response to response.data.response or response.data.text as those are two possible ways for the LLM to respond with
        const botResponse = response.data.response || response.data.text;
        //if there is no response throw an error
        if (!botResponse) {
            throw new Error('Empty response received from Ollama service');
        }
        //responses with the bot response in json format
        res.json({ response: botResponse });
        //if an error is caught log it in the console
    } catch (error) {
        console.error('Detailed chat error:', error.response?.data || error.message);
        let statusCode = 500;
        let errorMessage = 'An unexpected error occurred';
        //if the errror message includes the words too long the log that the request timed out and the program is still optional
        if (error.message.includes('too long')) {
            statusCode = 504;
            errorMessage = 'The request took too long to complete. Please try again.';
            //if the error message includes the words not running log that the LLM was not available and that user should try again later
        } else if (error.message.includes('not running')) {
            statusCode = 503;
            errorMessage = 'The model is currently unavailable. Please try again later.';
        }
        //this responses to the call with the status code which includes any error messages and the details in a json file format
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
    if (httpServer) httpServer.close();
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
    httpServer = app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
});
