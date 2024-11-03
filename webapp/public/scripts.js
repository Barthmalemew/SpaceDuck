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
    //Gets a random question from the API
    async function askRandomQuestion() {
        //This try function attemps to fetch an entry from the random questions endpoint if it succeeds it adds the message to the chat interface
        try {
            const response = await fetch('/api/random-question');
            const data = await response.json();
            if (response.ok) {
                addMessage(data.question);
            }
            //if an error occurs it sends a message to the console with the name of the error
        } catch (error) {
            console.error('Error fetching random question:', error);
        }
    }
    //seems to be trying to detect inactivity
    function resetInactivityTimer() {
        //this detects if there is a timout id in the variable inactivityTimer if there is it then clears the timeout and prevents the function askRandomQuestion from running I think
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
        }
        //this sets the id of the time out to the variable inactivity timer and then sets the function askRandomQuestion to run after Inactivity_timeout amount of miliseconds, unless the askRandomQuestion function is meant to work as a tool to detect if the connection has a issue its kinda pointless to do this 
        inactivityTimer = setTimeout(askRandomQuestion, INACTIVITY_TIMEOUT);
    }

    // Initialize the timer when the page loads
    resetInactivityTimer();

    // Reset timer when user interacts
    chatInput.addEventListener('input', resetInactivityTimer);
    chatMessages.addEventListener('scroll', resetInactivityTimer);

    async function sendMessage() {
        //sets the variable message to a trimed version of the value in the chat input variable
        const message = chatInput.value.trim();
        //pretty sure this is checking to make sure message isnt null and if it is it exists the function
        if (!message) return;

        // Add user message to chat
        addMessage(message, true);
        chatInput.value = '';
        sendButton.disabled = true;
        resetInactivityTimer();
        //this trys to send the users message to the server
        try {
            console.log('Sending message to server:', message);
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });
            //this sends a response request to the server and sets that to the variable data when it arrives
            const data = await response.json();
            if (response.ok) {
                if (data.response) {
                    addMessage(data.response);
                } else {
                    //throws an error if the response format is invalid
                    throw new Error('Invalid response format');
                }
            } else {
                //should now post the error in the message log instead of defaulting to the Unkown error occured message which should hopefully be more useful
                addMessage(`Error: ${error.message || 'Unknown error occurred'}`);
            }
        } catch (error) {
            addMessage('Sorry, something went wrong. Please try again.');
        } finally {
            sendButton.disabled = false;
        }
    }

    sendButton.addEventListener('click', sendMessage); //this adds an event listener that checks for if send button has been clicked and if so runs the send message function
    //adds a event listen to the chat input element that detects if the enter key has been pressed and the shift key was not being pressed at the same time and then runs the send message function if that happens
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});
