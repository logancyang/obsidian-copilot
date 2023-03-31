import { ItemView, WorkspaceLeaf } from 'obsidian';
import { CHATGPT_VIEW_STYLE } from './style';

export default class ChatGPTView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
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
    this.containerEl.empty();
    // Add the chat interface CSS styles
    this.containerEl.createEl('style', {
      text: CHATGPT_VIEW_STYLE,
    });

    // Create the chat interface HTML
    const container = this.containerEl.createDiv({ cls: 'chat-container' });

    const chatMessages = container.createDiv({ cls: 'chat-messages' });
    const chatInputContainer = container.createDiv({ cls: 'chat-input-container' });

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
  }

  // Create a message element and append it to the chatMessages div
  appendMessage(chatMessages: HTMLDivElement, message: string, sender: string) {
    const messageEl = chatMessages.createDiv({ cls: `chat-message ${sender}` });
    messageEl.innerHTML = message.replace(/\n/g, '<br>');
  }

  // Add a method to handle sending messages to ChatGPT
  handleSendMessage(chatInput: HTMLTextAreaElement, chatMessages: HTMLDivElement) {
    const message = chatInput.value;

    // Append the user's message to the chat interface
    this.appendMessage(chatMessages, message, 'user');

    // Your ChatGPT API interaction logic here
    console.log(`Sending message: ${message}`);

    // After receiving a response from the ChatGPT API, append it to the chat interface
    // Replace this with the actual response from the API
    const chatGPTResponse = 'This is a sample response from ChatGPT';
    this.appendMessage(chatMessages, chatGPTResponse, 'chatgpt');

    // Clear the textarea content after sending the message with a slight delay
    setTimeout(() => {
      chatInput.value = '';
      this.autosize(chatInput); // Reset the textarea height after clearing its value
    }, 10);
  }

  autosize(textarea: HTMLTextAreaElement) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }
}