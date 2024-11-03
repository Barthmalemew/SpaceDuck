/**
 * Frontend JavaScript for NASA Space Duck Chat Interface
 * Manages user interactions, message display, and API communication
 */
document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    const categorySelect = document.getElementById('categorySelect');
    const getQuestionButton = document.getElementById('getQuestionButton');
    const trainingContent = document.getElementById('trainingContent');
    let currentAnswer = null;

    // Adds a new message to the chat interface
    // @param message - The message text to display
    // @param isUser - Boolean indicating if message is from user
    function addMessage(message, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Function to display questions in the training content area
    function displayQuestions(questions) {
        if (questions.length === 0) {
            trainingContent.innerHTML = 'No questions available for this category.';
            return;
        }
        
        const questionsList = questions.map(q => 
            `<div class="question-item">
                <p><strong>Q:</strong> ${q.question}</p>
                <p class="answer hidden"><strong>A:</strong> ${q.correct_answer}</p>
            </div>`
        ).join('');
        
        trainingContent.innerHTML = questionsList;
    }

    // Event listener for category selection
    categorySelect.addEventListener('change', async () => {
        const category = categorySelect.value;
        const response = await fetch(`/api/questions/category/${encodeURIComponent(category)}`);
        const questions = await response.json();
        displayQuestions(questions);
    });

    //Gets a question from the API based on selected category
    async function getQuestion() {
        try {
            const category = categorySelect.value;
            const endpoint = category ? `/api/questions/${encodeURIComponent(category)}` : '/api/questions';
            const response = await fetch(endpoint);
            const data = await response.json();
            
            if (response.ok) {
                currentAnswer = data.correct_answer;
                const questionText = `Question (${data.category}): ${data.question}`;
                addMessage(questionText);
                getQuestionButton.textContent = 'Show Answer';
                getQuestionButton.onclick = showAnswer;
            }
        } catch (error) {
            console.error('Error fetching question:', error);
            addMessage('Error: Unable to fetch question. Please try again.');
        }
    }

    function showAnswer() {
        if (currentAnswer) {
            addMessage(`Answer: ${currentAnswer}`);
            getQuestionButton.textContent = 'Get Question';
            getQuestionButton.onclick = getQuestion;
            currentAnswer = null;
        }
    }

    // Event listeners for question controls
    getQuestionButton.addEventListener('click', getQuestion);

    async function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        // Clear input and disable button before sending
        const originalMessage = message;
        chatInput.value = '';
        sendButton.disabled = true;

        // Show user message
        addMessage(originalMessage, true);

        try {
            // Add loading indicator
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message bot-message loading';
            loadingDiv.textContent = 'Thinking...';
            chatMessages.appendChild(loadingDiv);

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: originalMessage }),
            });

            // Remove loading indicator
            chatMessages.removeChild(loadingDiv);

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Server error');
            }
            
            if (data.response) {
                addMessage(data.response);
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            addMessage(`Error: ${error.message || 'Unknown error occurred'}`);
        } finally {
            sendButton.disabled = false;
            // Remove loading indicator if it still exists
            const loadingDiv = document.querySelector('.loading');
            if (loadingDiv) {
                chatMessages.removeChild(loadingDiv);
            }
        }
    }

    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});
