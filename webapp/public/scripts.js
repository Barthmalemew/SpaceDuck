/**
 * Frontend JavaScript for NASA Space Duck Chat Interface
 * Manages user interactions, message display, and API communication
 */
//adds an event listener that checks for when the html content has been full parsed and then runs its contents if it finds that true
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
            //This sends an api request for a random question from the category provided
            const endpoint = `/api/questions/${encodeURIComponent(category)}`;
            //sets the response to the value of the const response and waits for the endpoint to return with the information before continueing
            const response = await fetch(endpoint);
            //this sets the const data to the value of the response in the format of a json file and waits for the operation to complete
            const data = await response.json();
            //this formats the answer to fit with the existing html being used
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
    //this fucntion shows the answer and then sets up the site so the user can ask for another  question
    function showAnswer() {
        if (currentAnswer) {
            const answerText = document.getElementById('answerText');
            answerText.classList.add('visible');
            getQuestionButton.textContent = 'Get Question';
            getQuestionButton.onclick = getQuestion;
            currentAnswer = null;
        }
    }
    //this function handles sending messages from the user to the LLM through the API
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
            //this sets data to the value of response in the json format and waits till it is completed before moving on
            const data = await response.json();
            //if the response is nonexistant then it will throw an error
            if (!response.ok) {
                throw new Error(data.error || 'Server error');
            }
            //this checks if the formating is correct and calls addMessage with data.response as the parameter if so and throws an error if the format is invalid
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