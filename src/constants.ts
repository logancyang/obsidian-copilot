import { CopilotSettings } from '@/main';

export const CHAR_LENGTH_LIMIT = 5800;
export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant named Copilot for Obsidian.';
export const DEFAULT_SETTINGS: CopilotSettings = {
  openAiApiKey: '',
  defaultModel: 'gpt-3.5-turbo',
  temperature: '0.7',
  maxTokens: '1000',
  contextTurns: '3',
  useNotesAsContext: false,
  userSystemPrompt: '',
  stream: true,
  debug: false,
};
export const OPEN_AI_API_URL = 'https://api.openai.com/v1/chat/completions';
