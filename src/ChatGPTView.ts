import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { SharedState } from './sharedState';


const MODEL = 'chatgpt';

export default class ChatGPTView extends ItemView {
  sharedState: SharedState;

  constructor(leaf: WorkspaceLeaf, sharedState: SharedState) {
    super(leaf);
    this.sharedState = sharedState;
  }

  // Return a unique identifier for this view
  getViewType(): string {
    return 'chat-gpt-view';
  }

  // Return an icon for this view
  getIcon(): string {
    return 'message-square';
  }

  // Return a title for this view
  getTitle(): string {
    return 'ChatGPT';
  }

  // Implement the getDisplayText method
  getDisplayText(): string {
    return 'ChatGPT';
  }

  // Render the chat interface and add event listeners
  async onOpen() {
    // Check if the chat interface is already created
    if (!this.containerEl.querySelector('.chat-container')) {
      this.createChatInterface();
    }
  }

  async onClose() {
  }

  // Create the chat interface
  createChatInterface() {
    this.containerEl.empty();

    // Create the chat interface HTML
    const container = this.containerEl.createDiv({ cls: 'chat-container' });
    const chatMessages = container.createDiv({ cls: 'chat-messages' });

    const bottomContainer = container.createDiv({ cls: 'bottom-container' });

    // const chatIconsContainer = bottomContainer.createDiv({ cls: 'chat-icons-container' });

    // const refreshIcon = this.containerEl.createEl('i', { cls: 'icon' });
    // setIcon(refreshIcon, 'refresh-cw');
    // chatIconsContainer.appendChild(refreshIcon);

    const chatInputContainer = bottomContainer.createDiv({ cls: 'chat-input-container' });
    const chatInput = chatInputContainer.createEl('textarea', { placeholder: 'Type your message here...' });
    const chatSendButton = chatInputContainer.createEl('button', { text: 'Send' });

    // Add event listeners
    chatSendButton.addEventListener('click', () => {
      this.handleSendMessage(chatInput as HTMLTextAreaElement, chatMessages as HTMLDivElement);
    });

    chatInput.addEventListener('keydown', (event) => {
      // Check if the 'shift' key is pressed and the 'enter' key is pressed
      if (event.shiftKey && event.key === 'Enter') {
        // Prevent the default behavior of 'Enter' key press
        event.preventDefault();
        // Create a new line
        chatInput.value += '\n';
        return;
      }
      if (event.key === 'Enter') {
        this.handleSendMessage(chatInput as HTMLTextAreaElement, chatMessages as HTMLDivElement);
      }
    });

    chatInput.addEventListener('input', () => {
      this.autosize(chatInput as HTMLTextAreaElement);
    });

    // Load the chat history
    const chatHistory = this.sharedState.getMessages();
    for (const { message, sender } of chatHistory) {
      this.appendMessage(chatMessages, message, sender);
    }
    this.scrollToBottom(chatMessages);
  }

  // Create a message element and append it to the chatMessages div
  appendMessage(chatMessages: HTMLDivElement, message: string, sender: string) {
    const messageEl = chatMessages.createDiv({ cls: `chat-message ${sender}` });
    // Add response message formatting here
    messageEl.innerHTML = message.replace(/\n/g, '<br>');
  }

  // Add a method to handle sending messages to ChatGPT
  handleSendMessage(chatInput: HTMLTextAreaElement, chatMessages: HTMLDivElement) {
    const message = chatInput.value;

    // Append the user's message to the chat interface
    this.appendMessage(chatMessages, message, 'user');
    // Store the user's message in the chat history
    this.sharedState.addMessage({ message, sender: 'user' });

    // Your ChatGPT API interaction logic here
    console.log(`Sending message: ${message}`);

    // After receiving a response from the ChatGPT API, append it to the chat interface
    // Replace this with the actual response from the API
    const chatGPTResponse = 'This is a sample response from ChatGPT AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    this.appendMessage(chatMessages, chatGPTResponse, MODEL);
    this.scrollToBottom(chatMessages);
    // Store the response in the chat history
    this.sharedState.addMessage({ message: chatGPTResponse, sender: MODEL });

    // Clear the textarea content after sending the message with a slight delay
    setTimeout(() => {
      chatInput.value = '';
      this.autosize(chatInput); // Reset the textarea height after clearing its value
    }, 10);
  }

  scrollToBottom(chatMessages: HTMLDivElement) {
    window.requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  autosize(textarea: HTMLTextAreaElement) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }
}