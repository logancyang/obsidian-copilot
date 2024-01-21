import { ChainType } from '@/chainFactory';
import {
  AZURE_MODELS,
  AZURE_OPENAI,
  DEFAULT_SETTINGS,
  DISPLAY_NAME_TO_MODEL,
  OPENAI,
  OPENAI_MODELS,
  USER_SENDER
} from '@/constants';
import { CopilotSettings } from '@/settings/SettingsPage';
import { ChatMessage } from '@/sharedState';
import {
  BaseChain,
  LLMChain,
  RetrievalQAChain
} from "langchain/chains";
import moment from 'moment';
import { TFile } from 'obsidian';

export const stringToChainType = (chain: string): ChainType => {
  switch(chain) {
    case 'llm_chain':
      return ChainType.LLM_CHAIN;
    case 'retrieval_qa':
      return ChainType.RETRIEVAL_QA_CHAIN;
    default:
      throw new Error(`Unknown chain type: ${chain}`);
  }
}

export const isLLMChain = (chain: BaseChain): chain is LLMChain => {
  return (chain as any).llm !== undefined;
}

export const isRetrievalQAChain = (chain: BaseChain): chain is RetrievalQAChain => {
  return (chain as any).retriever !== undefined;
}

export const isSupportedChain = (chain: BaseChain): chain is BaseChain => {
    return isLLMChain(chain) || isRetrievalQAChain(chain);
  }

export const getModelName = (modelDisplayName: string): string => {
  return DISPLAY_NAME_TO_MODEL[modelDisplayName];
}

export const getModelVendorMap = (): Record<string, string> => {
  const model_to_vendor: Record<string, string> = {};

  for (const model of OPENAI_MODELS) {
    model_to_vendor[model] = OPENAI;
  }

  for (const model of AZURE_MODELS) {
    model_to_vendor[model] = AZURE_OPENAI;
  }
  return model_to_vendor;
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
  return await this.app.vault.read(file);
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

export function useNoteAsContextPrompt(
  noteName: string,
  noteContent: string | null,
): string {
  return `Please read the note below and be ready to answer questions about it. `
    + `If there's no information about a certain topic, just say the note `
    + `does not mention it. `
    + `The content of the note is between "/***/":\n\n/***/\n\n${noteContent}\n\n/***/\n\n`
    + `Please reply with the following word for word:`
    + `"OK I've read this note titled [[ ${noteName} ]]. `
    + `Feel free to ask **specific** questions about it. For generic questions like 'give me a summary', 'brainstorm based on the content', Chat mode with *context sent in the prompt* is a better choice."\n`
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

export function fillInSelectionForCustomPrompt(prompt?: string) {
  return (selectedText: string): string => {
    if (!prompt) {
      return selectedText;
    }
    return prompt.replace('{}', selectedText);
  };
}
