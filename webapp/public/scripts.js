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
    function addMessage(message, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Gets a question from the API based on selected category
    async function getQuestion() {
        try {
            const category = categorySelect.value;
            if (!category) {
                trainingContent.innerHTML = 'Please select a topic first.';
                return;
            }

            const endpoint = `/api/questions/${encodeURIComponent(category)}`;
            const response = await fetch(endpoint);
            const data = await response.json();

            if (response.ok) {
                currentAnswer = data.correct_answer;
                trainingContent.innerHTML = `
                    <div class="question-display">
                        <h3>Question:</h3>
                        <p>${data.question}</p>
                        <div class="answer-text" id="answerText">
                            <h3>Answer:</h3>
                            <p>${data.correct_answer}</p>
                        </div>
                    </div>`;

                // Change button text and function
                getQuestionButton.textContent = 'Show Answer';
                getQuestionButton.onclick = showAnswer;
            }
        } catch (error) {
            console.error('Error fetching question:', error);
            trainingContent.innerHTML = 'Error: Unable to fetch question. Please try again.';
        }
    }

    function showAnswer() {
        if (currentAnswer) {
            const answerText = document.getElementById('answerText');
            answerText.classList.add('visible');
            getQuestionButton.textContent = 'Get Question';
            getQuestionButton.onclick = getQuestion;
            currentAnswer = null;
        }
    }

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

    // Event listeners
    getQuestionButton.addEventListener('click', getQuestion);
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});