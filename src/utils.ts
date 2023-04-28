import { DEFAULT_SETTINGS, USER_SENDER } from '@/constants';
import { CopilotSettings } from '@/main';
import { ChatMessage } from '@/sharedState';
import moment from 'moment';
import { TFile } from 'obsidian';

// Returns the last N messages from the chat history,
// last one being the newest ai message
export const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
  if (chatHistory.length === 0) {
    return [];
  }
  const lastAiMessageIndex = chatHistory.slice().reverse().findIndex(msg => msg.sender !== USER_SENDER);
  if (lastAiMessageIndex === -1) {
    // No ai messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - 1 - lastAiMessageIndex;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);
  return chatHistory.slice(startIndex, lastIndex + 1);
};

export const formatDateTime = (now: Date, timezone: 'local' | 'utc' = 'local') => {
  const formattedDateTime = moment(now);

  if (timezone === 'utc') {
    formattedDateTime.utc();
  }

  return formattedDateTime.format('YYYY_MM_DD-HH_mm_ss');
};

export async function getFileContent(file: TFile): Promise<string | null> {
  if (file.extension != "md") return null;
  return await this.app.vault.read(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const sanitizedSettings: CopilotSettings = { ...settings };
  sanitizedSettings.temperature = isNaN(parseFloat(settings.temperature))
    ? DEFAULT_SETTINGS.temperature
    : settings.temperature;

  sanitizedSettings.maxTokens = isNaN(parseFloat(settings.maxTokens))
    ? DEFAULT_SETTINGS.maxTokens
    : settings.maxTokens;

  sanitizedSettings.contextTurns = isNaN(parseFloat(settings.contextTurns))
    ? DEFAULT_SETTINGS.contextTurns
    : settings.contextTurns;

  return sanitizedSettings;
}

// Basic prompts
// Note that GPT4 is much better at following instructions than GPT3.5!
export function useNoteAsContextPrompt(
  noteName: string, noteContent: string | null
): string {
  return `Please read the note below and be ready to answer questions about it. `
    + `If there's no information about a certain topic, just say the note `
    + `does not mention it. `
    + `If you understand, please reply with the following word for word:`
    + `"OK I've read this note titled [[ ${noteName} ]]. `
    + `Feel free to ask related questions, such as 'give me a summary of this note in bullet points', 'what key questions does it answer', etc. "\n`
    + `The content of the note is between "---":\n---\n${noteContent}\n---\n`;
}

export function fixGrammarSpellingSelectionPrompt(selectedText: string): string {
  return `Please fix the grammar and spelling of the following text and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function summarizePrompt(selectedText: string): string {
  return `Please summarize the following text into bullet points and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function tocPrompt(selectedText: string): string {
  return `Please generate a table of contents for the following text and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function glossaryPrompt(selectedText: string): string {
  return `Please generate a glossary for the following text and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function simplifyPrompt(selectedText: string): string {
  return `Please simplify the following text so that a 6th-grader can understand:\n\n`
    + `${selectedText}`;
}

export function emojifyPrompt(selectedText: string): string {
  return `Please rewrite the following content in a fun way and insert emojis.`
    + `Insert at as many places as possible, but don't have any 2 emojis together.\n`
    + `Content: ${selectedText}`;
}

export function removeUrlsFromSelectionPrompt(selectedText: string): string {
  return `Please remove all URLs from the following text and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function rewriteTweetSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following content to under 280 characters using simple sentences. Please follow the instruction strictly. Content:\n
    + ${selectedText}`
}

export function rewriteTweetThreadSelectionPrompt(selectedText: string): string {
  return `Please follow the instructions closely step by step and rewrite the content to a thread. `
    + `1. Each paragraph must be under 240 characters. `
    + `2. The starting line is \`THREAD START\n\`, and the ending line is \`\nTHREAD END\`. `
    + `3. You must use \`\n\n---\n\n\` to separate each paragraph! Then return it without any other changes. `
    + `4. Make it as engaging as possible.\n The original content:\n\n`
    + `${selectedText}`;
}

export function rewriteShorterSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following text to make it half as long while keeping the meaning as much as possible:\n`
    + `${selectedText}`;
}

export function rewriteLongerSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following text to make it twice as long while keeping the meaning as much as possible:\n`
    + `${selectedText}`;
}

export function eli5SelectionPrompt(selectedText: string): string {
  return `Please explain the following text like I'm 5 years old:\n\n`
    + `${selectedText}`;
}

export function rewritePressReleaseSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following text to make it sound like a press release:\n\n`
    + `${selectedText}`;
}

export function createTranslateSelectionPrompt(language?: string) {
  return (selectedText: string): string => {
    return `Please translate the following text to ${language}:\n\n` + `${selectedText}`;
  };
}

export function createChangeToneSelectionPrompt(tone?: string) {
  return (selectedText: string): string => {
    return `Please change the tone of the following text to ${tone}:\n\n` + `${selectedText}`;
  };
}
