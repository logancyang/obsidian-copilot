import { ItemView, WorkspaceLeaf } from 'obsidian';

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

    // Create the chat interface HTML
    const container = this.containerEl.createDiv({ cls: 'chat-container' });

    const chatMessages = container.createDiv({ cls: 'chat-messages' });
    const chatInputContainer = container.createDiv({ cls: 'chat-input-container' });

    const chatInput = chatInputContainer.createEl('input', { type: 'text', placeholder: 'Type your message here...' });
    const chatSendButton = chatInputContainer.createEl('button', { text: 'Send' });

    // Add event listeners
    chatSendButton.addEventListener('click', () => {
      this.handleSendMessage(chatInput as HTMLInputElement, chatMessages as HTMLDivElement);
    });

    chatInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        this.handleSendMessage(chatInput as HTMLInputElement, chatMessages as HTMLDivElement);
      }
    });
  }

  // Create a message element and append it to the chatMessages div
  appendMessage(chatMessages: HTMLDivElement, message: string, sender: string) {
    const messageEl = chatMessages.createDiv({ cls: `chat-message ${sender}` });
    messageEl.createEl('span', { text: message });
  }

  // Add a method to handle sending messages to ChatGPT
  handleSendMessage(chatInput: HTMLInputElement, chatMessages: HTMLDivElement) {
    const message = chatInput.value;
    chatInput.value = '';

    // Append the user's message to the chat interface
    this.appendMessage(chatMessages, message, 'user');

    // Your ChatGPT API interaction logic here
    console.log(`Sending message: ${message}`);

    // After receiving a response from the ChatGPT API, append it to the chat interface
    // Replace this with the actual response from the API
    const chatGPTResponse = 'This is a sample response from ChatGPT';
    this.appendMessage(chatMessages, chatGPTResponse, 'chatgpt');
  }
}