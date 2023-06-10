import { CopilotSettings } from '@/main';

export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';
export const DEFAULT_SYSTEM_PROMPT = 'You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.';

// Embedding Providers
export const OPENAI = 'openai';
export const HUGGINGFACE = 'huggingface';
export const COHEREAI = 'cohereai';

// Embedding Models
export const DISTILBERT_NLI = 'sentence-transformers/distilbert-base-nli-mean-tokens';
export const INSTRUCTOR_XL = 'hkunlp/instructor-xl'; // Inference API is off for this
export const MPNET_V2 = 'sentence-transformers/all-mpnet-base-v2'; // Inference API returns 400

export const DEFAULT_SETTINGS: CopilotSettings = {
  openAiApiKey: '',
  huggingfaceApiKey: '',
  cohereApiKey: '',
  defaultModel: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 1000,
  contextTurns: 3,
  useNotesAsContext: false,
  userSystemPrompt: '',
  stream: true,
  embeddingProvider: OPENAI,
  debug: false,
};
export const OPEN_AI_API_URL = 'https://api.openai.com/v1/chat/completions';
