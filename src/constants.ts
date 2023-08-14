import { CopilotSettings } from '@/main';

export const CHAT_VIEWTYPE = 'copilot-chat-view';
export const USER_SENDER = 'user';
export const AI_SENDER = 'ai';
export const DEFAULT_SYSTEM_PROMPT = 'You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.';

export enum ChatModels {
  GPT_35_TURBO = 'gpt-3.5-turbo',
  GPT_35_TURBO_16K = 'gpt-3.5-turbo-16k',
  GPT_4 = 'gpt-4',
  GPT_4_32K = 'gpt-4-32k',
  CLAUDE_1 = 'claude-1',
  CLAUDE_1_100K = 'claude-1-100k',
  CLAUDE_INSTANT_1 = 'claude-instant-1',
  CLAUDE_INSTANT_1_100K = 'claude-instant-1-100k',
  AZURE_GPT_35_TURBO = 'gpt-35-turbo',
  AZURE_GPT_35_TURBO_16K = 'gpt-35-turbo-16k',
}

export enum ChatModelDisplayNames {
  GPT_35_TURBO = 'GPT-3.5',
  GPT_35_TURBO_16K = 'GPT-3.5 16K',
  GPT_4 = 'GPT-4',
  GPT_4_32K = 'GPT-4 32K',
  CLAUDE_1 = 'CLAUDE-1',
  CLAUDE_1_100K = 'CLAUDE-1-100K',
  CLAUDE_INSTANT_1 = 'CLAUDE-INSTANT',
  CLAUDE_INSTANT_1_100K = 'CLAUDE-INSTANT-100K',
  AZURE_GPT_35_TURBO = 'AZURE GPT-3.5',
  AZURE_GPT_35_TURBO_16K = 'AZURE GPT-3.5-16K',
  AZURE_GPT_4 = 'AZURE GPT-4',
  AZURE_GPT_4_32K = 'AZURE GPT-4 32K',
  LOCAL_AI = 'LocalAI',
}

export const OPENAI_MODELS = new Set([
    ChatModelDisplayNames.GPT_35_TURBO,
    ChatModelDisplayNames.GPT_35_TURBO_16K,
    ChatModelDisplayNames.GPT_4,
    ChatModelDisplayNames.GPT_4_32K,
    ChatModelDisplayNames.LOCAL_AI,
]);

export const AZURE_MODELS = new Set([
    ChatModelDisplayNames.AZURE_GPT_35_TURBO,
    ChatModelDisplayNames.AZURE_GPT_35_TURBO_16K,
    ChatModelDisplayNames.AZURE_GPT_4,
    ChatModelDisplayNames.AZURE_GPT_4_32K,
]);

export const CLAUDE_MODELS = new Set([
    ChatModelDisplayNames.CLAUDE_1,
    ChatModelDisplayNames.CLAUDE_1_100K,
    ChatModelDisplayNames.CLAUDE_INSTANT_1,
    ChatModelDisplayNames.CLAUDE_INSTANT_1_100K,
]);

export const DISPLAY_NAME_TO_MODEL: Record<string, string> = {
  [ChatModelDisplayNames.GPT_35_TURBO]: ChatModels.GPT_35_TURBO,
  [ChatModelDisplayNames.GPT_35_TURBO_16K]: ChatModels.GPT_35_TURBO_16K,
  [ChatModelDisplayNames.GPT_4]: ChatModels.GPT_4,
  [ChatModelDisplayNames.GPT_4_32K]: ChatModels.GPT_4_32K,
  [ChatModelDisplayNames.CLAUDE_1]: ChatModels.CLAUDE_1,
  [ChatModelDisplayNames.CLAUDE_1_100K]: ChatModels.CLAUDE_1_100K,
  [ChatModelDisplayNames.CLAUDE_INSTANT_1]: ChatModels.CLAUDE_INSTANT_1,
  [ChatModelDisplayNames.CLAUDE_INSTANT_1_100K]: ChatModels.CLAUDE_INSTANT_1_100K,
  [ChatModelDisplayNames.AZURE_GPT_35_TURBO]: ChatModels.AZURE_GPT_35_TURBO,
  [ChatModelDisplayNames.AZURE_GPT_35_TURBO_16K]: ChatModels.AZURE_GPT_35_TURBO_16K,
  [ChatModelDisplayNames.AZURE_GPT_4]: ChatModels.GPT_4,
  [ChatModelDisplayNames.AZURE_GPT_4_32K]: ChatModels.GPT_4_32K,
};

// Model Providers
export const OPENAI = 'openai';
export const HUGGINGFACE = 'huggingface';
export const COHEREAI = 'cohereai';
export const AZURE_OPENAI = 'azure_openai';
export const ANTHROPIC = 'anthropic';
export const LOCALAI = 'localai';

export const VENDOR_MODELS: Record<string, Set<string>> = {
  [OPENAI]: OPENAI_MODELS,
  [AZURE_OPENAI]: AZURE_MODELS,
  [ANTHROPIC]: CLAUDE_MODELS,
};

// Embedding Models
export const DISTILBERT_NLI = 'sentence-transformers/distilbert-base-nli-mean-tokens';
export const INSTRUCTOR_XL = 'hkunlp/instructor-xl'; // Inference API is off for this
export const MPNET_V2 = 'sentence-transformers/all-mpnet-base-v2'; // Inference API returns 400

// export const LOCALAI_DEFAULT_MODEL = 'ggml-gpt4all-j';

export const DEFAULT_SETTINGS: CopilotSettings = {
  openAIApiKey: '',
  huggingfaceApiKey: '',
  cohereApiKey: '',
  anthropicApiKey: '',
  azureOpenAIApiKey: '',
  azureOpenAIApiInstanceName: '',
  azureOpenAIApiDeploymentName: '',
  azureOpenAIApiVersion: '',
  azureOpenAIApiEmbeddingDeploymentName: '',
  defaultModel: ChatModels.GPT_35_TURBO_16K,
  defaultModelDisplayName: ChatModelDisplayNames.GPT_35_TURBO_16K,
  temperature: 0.7,
  maxTokens: 1000,
  contextTurns: 3,
  useNotesAsContext: false,
  userSystemPrompt: '',
  openAIProxyBaseUrl: '',
  localAIModel: '',
  ttlDays: 30,
  stream: true,
  embeddingProvider: OPENAI,
  defaultSaveFolder: 'copilot-conversations',
  debug: false,
};
export const OPEN_AI_API_URL = 'https://api.openai.com/v1/chat/completions';
