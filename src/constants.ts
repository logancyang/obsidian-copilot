import { CopilotSettings } from '@/main';

export const CHAR_LENGTH_LIMIT = 5800;
export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';
export const DEFAULT_SETTINGS: CopilotSettings = {
  openAiApiKey: '',
  defaultModel: 'gpt-3.5-turbo',
  temperature: '0.7',
  maxTokens: '1000',
  contextTurns: '3',
};
