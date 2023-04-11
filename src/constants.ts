export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';

// Basic Prompts
export const USE_NOTE_AS_CONTEXT_PROMPT
  = `Please answer questions only based on the content below. `
    + `If there's no information about a certain topic, just say the note `
    + `does not mention it. If you understand, please reply with `
    + `"OK I've read this note. Feel free to ask related questions."\n`
    + `Here's the content of the note:\n\n`;
