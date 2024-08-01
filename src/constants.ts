import { CopilotSettings } from "@/settings/SettingsPage";

export const CHAT_VIEWTYPE = "copilot-chat-view";
export const USER_SENDER = "user";
export const AI_SENDER = "ai";
export const DEFAULT_SYSTEM_PROMPT =
  "You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.";

export enum ChatModels {
  GPT_35_TURBO = "gpt-3.5-turbo",
  GPT_35_TURBO_16K = "gpt-3.5-turbo-16k",
  GPT_4 = "gpt-4",
  GPT_4o = "gpt-4o",
  GPT_4o_mini = "gpt-4o-mini",
  GPT_4_TURBO = "gpt-4-turbo-preview",
  GPT_4_32K = "gpt-4-32k",
  GEMINI_PRO = "gemini-pro",
  GROQ = "llama3-70b-8192",
  OLLAMA = "ollama",
}

export enum ChatModelDisplayNames {
  GPT_35_TURBO = "GPT-3.5",
  GPT_35_TURBO_16K = "GPT-3.5 16K",
  GPT_4 = "GPT-4",
  GPT_4o = "GPT-4o",
  GPT_4o_mini = "GPT-4o mini",
  GPT_4_TURBO = "GPT-4 TURBO",
  GPT_4_32K = "GPT-4 32K",
  AZURE_OPENAI = "AZURE OPENAI",
  CLAUDE = "CLAUDE",
  GEMINI_PRO = "GEMINI PRO",
  OPENROUTERAI = "OPENROUTER.AI",
  GROQ = "GROQ",
  OLLAMA = "OLLAMA (LOCAL)",
  LM_STUDIO = "LM STUDIO (LOCAL)",
}

export const OPENAI_MODELS = new Set([
  ChatModelDisplayNames.GPT_35_TURBO,
  ChatModelDisplayNames.GPT_35_TURBO_16K,
  ChatModelDisplayNames.GPT_4,
  ChatModelDisplayNames.GPT_4o,
  ChatModelDisplayNames.GPT_4o_mini,
  ChatModelDisplayNames.GPT_4_TURBO,
  ChatModelDisplayNames.GPT_4_32K,
  ChatModelDisplayNames.LM_STUDIO,
]);

export const AZURE_MODELS = new Set([ChatModelDisplayNames.AZURE_OPENAI]);

export const GOOGLE_MODELS = new Set([ChatModelDisplayNames.GEMINI_PRO]);

export const ANTHROPIC_MODELS = new Set([ChatModelDisplayNames.CLAUDE]);

export const OPENROUTERAI_MODELS = new Set([
  ChatModelDisplayNames.OPENROUTERAI,
]);

export const OLLAMA_MODELS = new Set([ChatModelDisplayNames.OLLAMA]);

export const LM_STUDIO_MODELS = new Set([ChatModelDisplayNames.LM_STUDIO]);

export const DISPLAY_NAME_TO_MODEL: Record<string, string> = {
  [ChatModelDisplayNames.GPT_35_TURBO]: ChatModels.GPT_35_TURBO,
  [ChatModelDisplayNames.GPT_35_TURBO_16K]: ChatModels.GPT_35_TURBO_16K,
  [ChatModelDisplayNames.GPT_4]: ChatModels.GPT_4,
  [ChatModelDisplayNames.GPT_4o]: ChatModels.GPT_4o,
  [ChatModelDisplayNames.GPT_4o_mini]: ChatModels.GPT_4o_mini,
  [ChatModelDisplayNames.GPT_4_TURBO]: ChatModels.GPT_4_TURBO,
  [ChatModelDisplayNames.GPT_4_32K]: ChatModels.GPT_4_32K,
  [ChatModelDisplayNames.AZURE_OPENAI]: "azure_openai",
  [ChatModelDisplayNames.GEMINI_PRO]: ChatModels.GEMINI_PRO,
};

export const GROQ_MODELS = new Set([ChatModelDisplayNames.GROQ]);

// Model Providers
export enum ModelProviders {
  OPENAI = "openai",
  HUGGINGFACE = "huggingface",
  COHEREAI = "cohereai",
  AZURE_OPENAI = "azure_openai",
  ANTHROPIC = "anthropic",
  GOOGLE = "google",
  OPENROUTERAI = "openrouterai",
  LM_STUDIO = "lm_studio",
  OLLAMA = "ollama",
  GROQ = "groq",
}

export const VENDOR_MODELS: Record<string, Set<string>> = {
  [ModelProviders.OPENAI]: OPENAI_MODELS,
  [ModelProviders.AZURE_OPENAI]: AZURE_MODELS,
  [ModelProviders.GOOGLE]: GOOGLE_MODELS,
  [ModelProviders.ANTHROPIC]: ANTHROPIC_MODELS,
  [ModelProviders.OPENROUTERAI]: OPENROUTERAI_MODELS,
  [ModelProviders.OLLAMA]: OLLAMA_MODELS,
  [ModelProviders.LM_STUDIO]: LM_STUDIO_MODELS,
  [ModelProviders.GROQ]: GROQ_MODELS,
};

export const EMBEDDING_PROVIDERS = [
  ModelProviders.OPENAI,
  ModelProviders.AZURE_OPENAI,
  ModelProviders.COHEREAI,
  ModelProviders.HUGGINGFACE,
  ModelProviders.OLLAMA,
];

export enum EmbeddingModels {
  OPENAI_EMBEDDING_ADA_V2 = "text-embedding-ada-002",
  OPENAI_EMBEDDING_SMALL = "text-embedding-3-small",
  OPENAI_EMBEDDING_LARGE = "text-embedding-3-large",
  AZURE_OPENAI = "azure-openai",
  COHEREAI = "cohereai",
  OLLAMA_NOMIC = "ollama-nomic-embed-text",
}

export const EMBEDDING_MODEL_TO_PROVIDERS: Record<string, string> = {
  [EmbeddingModels.OPENAI_EMBEDDING_ADA_V2]: ModelProviders.OPENAI,
  [EmbeddingModels.OPENAI_EMBEDDING_SMALL]: ModelProviders.OPENAI,
  [EmbeddingModels.OPENAI_EMBEDDING_LARGE]: ModelProviders.OPENAI,
  [EmbeddingModels.AZURE_OPENAI]: ModelProviders.AZURE_OPENAI,
  [EmbeddingModels.COHEREAI]: ModelProviders.COHEREAI,
  [EmbeddingModels.OLLAMA_NOMIC]: ModelProviders.OLLAMA,
};

// Embedding Models
export const NOMIC_EMBED_TEXT = "nomic-embed-text";
// export const DISTILBERT_NLI = 'sentence-transformers/distilbert-base-nli-mean-tokens';
// export const INSTRUCTOR_XL = 'hkunlp/instructor-xl'; // Inference API is off for this
// export const MPNET_V2 = 'sentence-transformers/all-mpnet-base-v2'; // Inference API returns 400

export enum VAULT_VECTOR_STORE_STRATEGY {
  NEVER = "NEVER",
  ON_STARTUP = "ON STARTUP",
  ON_MODE_SWITCH = "ON MODE SWITCH",
}

export const VAULT_VECTOR_STORE_STRATEGIES = [
  VAULT_VECTOR_STORE_STRATEGY.NEVER,
  VAULT_VECTOR_STORE_STRATEGY.ON_STARTUP,
  VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH,
];

export const PROXY_SERVER_PORT = 53001;

export const DEFAULT_SETTINGS: CopilotSettings = {
  openAIApiKey: "",
  openAIOrgId: "",
  huggingfaceApiKey: "",
  cohereApiKey: "",
  anthropicApiKey: "",
  anthropicModel: "claude-3-5-sonnet-20240620",
  azureOpenAIApiKey: "",
  azureOpenAIApiInstanceName: "",
  azureOpenAIApiDeploymentName: "",
  azureOpenAIApiVersion: "",
  azureOpenAIApiEmbeddingDeploymentName: "",
  googleApiKey: "",
  openRouterAiApiKey: "",
  openRouterModel: "cognitivecomputations/dolphin-mixtral-8x7b",
  defaultModel: ChatModels.GPT_4_TURBO,
  defaultModelDisplayName: ChatModelDisplayNames.GPT_4_TURBO,
  embeddingModel: EmbeddingModels.OPENAI_EMBEDDING_SMALL,
  temperature: 0.1,
  maxTokens: 1000,
  contextTurns: 15,
  userSystemPrompt: "",
  openAIProxyBaseUrl: "",
  useOpenAILocalProxy: false,
  openAIProxyModelName: "",
  openAIEmbeddingProxyBaseUrl: "",
  openAIEmbeddingProxyModelName: "",
  ollamaModel: "llama2",
  ollamaBaseUrl: "",
  lmStudioBaseUrl: "http://localhost:1234/v1",
  stream: true,
  defaultSaveFolder: "copilot-conversations",
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.NEVER,
  qaExclusionPaths: "",
  chatNoteContextPath: "",
  chatNoteContextTags: [],
  debug: false,
  enableEncryption: false,
  maxSourceChunks: 3,
  groqModel: "llama3-70b-8192",
  groqApiKey: "",
};
