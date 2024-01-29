import { ChainType } from '@/chainFactory';
import {
  DEFAULT_SETTINGS,
  DISPLAY_NAME_TO_MODEL,
  USER_SENDER
} from '@/constants';
import { CopilotSettings } from '@/settings/SettingsPage';
import { ChatMessage } from '@/sharedState';
import { MemoryVariables } from "@langchain/core/memory";
import { RunnableSequence } from "@langchain/core/runnables";
import {
  BaseChain,
  RetrievalQAChain
} from "langchain/chains";
import moment from 'moment';
import { TFile, Vault } from 'obsidian';

export const isFolderMatch = (fileFullpath: string, inputPath: string): boolean => {
  const fileSegments = fileFullpath.split('/').map(segment => segment.toLowerCase());
  return fileSegments.includes(inputPath.toLowerCase());
}

export const getNotesFromPath = async (vault: Vault, path: string): Promise<TFile[]> => {
  const files = await vault.getMarkdownFiles();

  // Special handling for the root path '/'
  if (path === '/') {
    return files;
  }

  // Split the path to get the last folder name
  const pathSegments = path.split('/');
  const lastSegment = pathSegments[pathSegments.length - 1].toLowerCase();

  return files.filter(file => {
    // Split the file path and get the last directory name
    return isFolderMatch(file.path, lastSegment) || file.basename === lastSegment;
  });
}

export const stringToChainType = (chain: string): ChainType => {
  switch (chain) {
    case 'llm_chain':
      return ChainType.LLM_CHAIN;
    case 'retrieval_qa':
      return ChainType.RETRIEVAL_QA_CHAIN;
    case 'vault_qa':
      return ChainType.VAULT_QA_CHAIN
    default:
      throw new Error(`Unknown chain type: ${chain}`);
  }
}

export const isLLMChain = (chain: RunnableSequence): chain is RunnableSequence => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.modelName || (chain as any).last.bound.model;
}

export const isRetrievalQAChain = (chain: BaseChain): chain is RetrievalQAChain => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.retriever !== undefined;
}

export const isSupportedChain = (chain: RunnableSequence): chain is RunnableSequence => {
  return isLLMChain(chain) || isRetrievalQAChain(chain);
}

export const getModelName = (modelDisplayName: string): string => {
  return DISPLAY_NAME_TO_MODEL[modelDisplayName];
}

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
  return await this.app.vault.cachedRead(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const sanitizedSettings: CopilotSettings = { ...settings };

  // Stuff in settings are string even when the interface has number type!
  const temperature = Number(settings.temperature);
  sanitizedSettings.temperature = isNaN(temperature)
    ? DEFAULT_SETTINGS.temperature
    : temperature;

  const maxTokens = Number(settings.maxTokens);
  sanitizedSettings.maxTokens = isNaN(maxTokens)
    ? DEFAULT_SETTINGS.maxTokens
    : maxTokens;

  const contextTurns = Number(settings.contextTurns);
  sanitizedSettings.contextTurns = isNaN(contextTurns)
    ? DEFAULT_SETTINGS.contextTurns
    : contextTurns;

  return sanitizedSettings;
}

// Basic prompts
// Note that GPT4 is much better at following instructions than GPT3.5!
export function sendNoteContentPrompt(
  noteName: string,
  noteContent: string | null,
): string {
  return `Please read the note below and be ready to answer questions about it. `
    + `If there's no information about a certain topic, just say the note `
    + `does not mention it. `
    + `The content of the note is between "/***/":\n\n/***/\n\n${noteContent}\n\n/***/\n\n`
    + `Please reply with the following word for word:`
    + `"OK I've read this note titled [[ ${noteName} ]]. `
    + `Feel free to ask related questions, such as 'give me a summary of this note in bullet points', 'what key questions does it answer', etc. "\n`
}

export function sendNotesContentPrompt(notes: { name: string; content: string }[]): string {
  return `Please read the notes below and be ready to answer questions about them. `
    + `If there's no information about a certain topic, just say the note `
    + `does not mention it. `
    + `The content of the note is between "/***/":\n\n/***/\n\n${JSON.stringify(notes)}\n\n/***/\n\n`
    + `Please reply with the following word for word:`
    + `"OK I've read these notes. `
    + `Feel free to ask related questions, such as 'give me a summary of these notes in bullet points', 'what key questions does these notes answer', etc. "\n`
}

export function getSendChatContextNotesPrompt(notes: { name: string; content: string }[]): string {
  const noteTitles = notes.map(note => `[[${note.name}]]`).join('\n\n');
  return `Please read the notes below and be ready to answer questions about them. \n\n${noteTitles}`;
}

export function fixGrammarSpellingSelectionPrompt(selectedText: string): string {
  return `Please fix the grammar and spelling of the following text and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function summarizePrompt(selectedText: string): string {
  return `Please summarize the following text into bullet points and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n`
    + `${selectedText}`;
}

export function tocPrompt(selectedText: string): string {
  return `Please generate a table of contents for the following text and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n`
    + `${selectedText}`;
}

export function glossaryPrompt(selectedText: string): string {
  return `Please generate a glossary for the following text and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n`
    + `${selectedText}`;
}

export function simplifyPrompt(selectedText: string): string {
  return `Please simplify the following text so that a 6th-grader can understand. Output in the same language as the source, do not output English if it is not English:\n\n`
    + `${selectedText}`;
}

export function emojifyPrompt(selectedText: string): string {
  return `Please insert emojis to the following content without changing the text.`
    + `Insert at as many places as possible, but don't have any 2 emojis together. The original text must be returned.\n`
    + `Content: ${selectedText}`;
}

export function removeUrlsFromSelectionPrompt(selectedText: string): string {
  return `Please remove all URLs from the following text and return it without any other changes:\n\n`
    + `${selectedText}`;
}

export function rewriteTweetSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following content to under 280 characters using simple sentences. Output in the same language as the source, do not output English if it is not English. Please follow the instruction strictly. Content:\n
    + ${selectedText}`
}

export function rewriteTweetThreadSelectionPrompt(selectedText: string): string {
  return `Please follow the instructions closely step by step and rewrite the content to a thread. `
    + `1. Each paragraph must be under 240 characters. `
    + `2. The starting line is \`THREAD START\n\`, and the ending line is \`\nTHREAD END\`. `
    + `3. You must use \`\n\n---\n\n\` to separate each paragraph! Then return it without any other changes. `
    + `4. Make it as engaging as possible.`
    + `5. Output in the same language as the source, do not output English if it is not English.\n The original content:\n\n`
    + `${selectedText}`;
}

export function rewriteShorterSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following text to make it half as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n`
    + `${selectedText}`;
}

export function rewriteLongerSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following text to make it twice as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n`
    + `${selectedText}`;
}

export function eli5SelectionPrompt(selectedText: string): string {
  return `Please explain the following text like I'm 5 years old. Output in the same language as the source, do not output English if it is not English:\n\n`
    + `${selectedText}`;
}

export function rewritePressReleaseSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following text to make it sound like a press release. Output in the same language as the source, do not output English if it is not English:\n\n`
    + `${selectedText}`;
}

export function createTranslateSelectionPrompt(language?: string) {
  return (selectedText: string): string => {
    return `Please translate the following text to ${language}:\n\n` + `${selectedText}`;
  };
}

export function createChangeToneSelectionPrompt(tone?: string) {
  return (selectedText: string): string => {
    return `Please change the tone of the following text to ${tone}. Output in the same language as the source, do not output English if it is not English:\n\n` + `${selectedText}`;
  };
}

export function createAdhocSelectionPrompt(adhocPrompt?: string) {
  return (selectedText: string): string => {
    if (!adhocPrompt) {
      return selectedText;
    }
    return `${adhocPrompt}.\n\n` + `${selectedText}`;
  };
}

export function fillInSelectionForCustomPrompt(prompt?: string) {
  return (selectedText: string): string => {
    if (!prompt) {
      return selectedText;
    }
    return prompt.replace('{}', selectedText);
  };
}

export function extractChatHistory(memoryVariables: MemoryVariables): [string, string][] {
  const chatHistory: [string, string][] = [];
  const { history } = memoryVariables;

  for (let i = 0; i < history.length; i += 2) {
    const userMessage = history[i]?.content || '';
    const aiMessage = history[i + 1]?.content || '';
    chatHistory.push([userMessage, aiMessage]);
  }

  return chatHistory;
}
