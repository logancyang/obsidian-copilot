export const CHATGPT_VIEW_STYLE = `
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .chat-messages {
    flex-grow: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .chat-message.user {
    background-color: #3a3a3a;
    color: #ffffff;
    border-radius: 5px;
    padding: 8px;
    margin-bottom: 8px;
  }
  .chat-message.chatgpt {
    background-color: #e6e6e6;
    color: #333333;
    border-radius: 5px;
    padding: 8px;
    margin-bottom: 8px;
  }
  .chat-input-container {
    display: flex;
    padding: 8px;
  }
  .chat-input-container textarea {
    flex-grow: 1;
    margin-right: 8px;
    margin-bottom: 32px;
    max-height: 200px; /* Set a maximum height for the textarea */
    resize: vertical; /* Allow vertical resizing of the textarea */
    overflow: auto; /* Enable scrolling if the content exceeds the max-height */
  }
`