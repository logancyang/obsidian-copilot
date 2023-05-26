import { CopilotSettings } from '@/main';

export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';
export const DEFAULT_SYSTEM_PROMPT = 'You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.';
export const OPENAI = 'openai';
export const HUGGINGFACE = 'huggingface';
export const DEFAULT_SETTINGS: CopilotSettings = {
  openAiApiKey: '',
  huggingfaceApiKey: '',
  defaultModel: 'gpt-3.5-turbo',
  temperature: '0.7',
  maxTokens: '1000',
  contextTurns: '3',
  useNotesAsContext: false,
  userSystemPrompt: '',
  stream: true,
  embeddingProvider: OPENAI,
  debug: false,
};
export const OPEN_AI_API_URL = 'https://api.openai.com/v1/chat/completions';
