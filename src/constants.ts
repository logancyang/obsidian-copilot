import { CopilotSettings } from '@/main';

export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';
export const DEFAULT_SYSTEM_PROMPT = 'You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.';

// Chat Models
export const GPT_35_TURBO = 'gpt-3.5-turbo';
export const GPT_35_TURBO_16K = 'gpt-3.5-turbo-16k';
export const GPT_4 = 'gpt-4';
export const GPT_4_32K = 'gpt-4-32k';
export const CLAUDE_1 = 'claude-1';
export const CLAUDE_1_100K = 'claude-1-100k';
export const CLAUDE_INSTANT_1 = 'claude-instant-1';
export const CLAUDE_INSTANT_1_100K = 'claude-instant-1-100k';
export const AZURE_GPT_35_TURBO = 'gpt-35-turbo';

export const GPT_35_TURBO_DISPLAY_NAME = 'GPT-3.5';
export const GPT_35_TURBO_16K_DISPLAY_NAME = 'GPT-3.5 16K';
export const GPT_4_DISPLAY_NAME = 'GPT-4';
export const GPT_4_32K_DISPLAY_NAME = 'GPT-4 32K';
export const CLAUDE_1_DISPLAY_NAME = 'CLAUDE-1';
export const CLAUDE_1_100K_DISPLAY_NAME = 'CLAUDE-1-100K';
export const CLAUDE_INSTANT_1_DISPLAY_NAME = 'CLAUDE-INSTANT';
export const CLAUDE_INSTANT_1_100K_DISPLAY_NAME = 'CLAUDE-INSTANT-100K';
export const AZURE_GPT_35_TURBO_DISPLAY_NAME = 'AZURE GPT-3.5';
export const AZURE_GPT_4_DISPLAY_NAME = 'AZURE GPT-4';
export const AZURE_GPT_4_32K_DISPLAY_NAME = 'AZURE GPT-4 32K';

export const OPENAI_MODELS = new Set([
    GPT_35_TURBO_DISPLAY_NAME,
    GPT_35_TURBO_16K_DISPLAY_NAME,
    GPT_4_DISPLAY_NAME,
    GPT_4_32K_DISPLAY_NAME,
]);

export const AZURE_MODELS = new Set([
    AZURE_GPT_35_TURBO_DISPLAY_NAME,
    AZURE_GPT_4_DISPLAY_NAME,
    AZURE_GPT_4_32K_DISPLAY_NAME,
]);

export const CLAUDE_MODELS = new Set([
    CLAUDE_1_DISPLAY_NAME,
    CLAUDE_1_100K_DISPLAY_NAME,
    CLAUDE_INSTANT_1_DISPLAY_NAME,
    CLAUDE_INSTANT_1_100K_DISPLAY_NAME,
]);

export const CHAT_MODELS: Record<string, string> = {
  GPT_35_TURBO: GPT_35_TURBO_DISPLAY_NAME,
  GPT_35_TURBO_16K: GPT_35_TURBO_16K_DISPLAY_NAME,
  GPT_4: GPT_4_DISPLAY_NAME,
  GPT_4_32K: GPT_4_32K_DISPLAY_NAME,
  CLAUDE_1: CLAUDE_1_DISPLAY_NAME,
  CLAUDE_1_100K: CLAUDE_1_100K_DISPLAY_NAME,
  CLAUDE_INSTANT_1: CLAUDE_INSTANT_1_DISPLAY_NAME,
  CLAUDE_INSTANT_1_100K: CLAUDE_INSTANT_1_100K_DISPLAY_NAME,
  AZURE_GPT_35_TURBO: AZURE_GPT_35_TURBO_DISPLAY_NAME,
};

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
  anthropicApiKey: '',
  azureOpenAIApiKey: '',
  azureOpenAIApiInstanceName: '',
  azureOpenAIApiDeploymentName: '',
  azureOpenAIApiVersion: '',
  defaultModel: GPT_35_TURBO,
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
