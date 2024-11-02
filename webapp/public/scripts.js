/**
 * Frontend JavaScript for NASA Space Duck Chat Interface
 * Manages user interactions, message display, and API communication
 */
document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    let inactivityTimer = null;
    const INACTIVITY_TIMEOUT = 30000; // 30 seconds

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

    async function askRandomQuestion() {
        try {
            const response = await fetch('/api/random-question');
            const data = await response.json();
            if (response.ok) {
                addMessage(data.question);
            }
        } catch (error) {
            console.error('Error fetching random question:', error);
        }
    }

    function resetInactivityTimer() {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
        }
        inactivityTimer = setTimeout(askRandomQuestion, INACTIVITY_TIMEOUT);
    }

    // Initialize the timer when the page loads
    resetInactivityTimer();

    // Reset timer when user interacts
    chatInput.addEventListener('input', resetInactivityTimer);
    chatMessages.addEventListener('scroll', resetInactivityTimer);

    async function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        // Add user message to chat
        addMessage(message, true);
        chatInput.value = '';
        sendButton.disabled = true;
        resetInactivityTimer();

        try {
            console.log('Sending message to server:', message);
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            const data = await response.json();
            if (response.ok) {
                if (data.response) {
                    addMessage(data.response);
                } else {
                    throw new Error('Invalid response format');
                }
            } else {
                addMessage(`Error: ${data.error || 'Unknown error occurred'}`);
            }
        } catch (error) {
            addMessage('Sorry, something went wrong. Please try again.');
        } finally {
            sendButton.disabled = false;
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
