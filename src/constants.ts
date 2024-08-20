import { CopilotSettings } from "@/settings/SettingsPage";

export const CHAT_VIEWTYPE = "copilot-chat-view";
export const USER_SENDER = "user";
export const AI_SENDER = "ai";
export const DEFAULT_SYSTEM_PROMPT =
  "You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.";

export enum ChatModels {
  GPT_4 = "gpt-4",
  GPT_4o = "gpt-4o",
  GPT_4o_mini = "gpt-4o-mini",
  GPT_4_TURBO = "gpt-4-turbo-preview",
  GPT_4_32K = "gpt-4-32k",
  GEMINI_PRO = "gemini-1.5-pro",
  GEMINI_FLASH = "gemini-1.5-flash",
  GROQ = "llama3-70b-8192",
  OLLAMA = "ollama",
}

export enum ChatModelDisplayNames {
  GPT_4 = "GPT-4",
  GPT_4o = "GPT-4o",
  GPT_4o_mini = "GPT-4o mini",
  GPT_4_TURBO = "GPT-4 TURBO",
  GPT_4_32K = "GPT-4 32K",
  AZURE_OPENAI = "AZURE OPENAI",
  CLAUDE = "CLAUDE",
  GEMINI_PRO = "GEMINI 1.5 PRO",
  GEMINI_FLASH = "GEMINI 1.5 FLASH",
  OPENROUTERAI = "OPENROUTER.AI",
  GROQ = "GROQ",
  OLLAMA = "OLLAMA (LOCAL)",
  LM_STUDIO = "LM STUDIO (LOCAL)",
}

export const OPENAI_MODELS = new Set([
  ChatModelDisplayNames.GPT_4,
  ChatModelDisplayNames.GPT_4o,
  ChatModelDisplayNames.GPT_4o_mini,
  ChatModelDisplayNames.GPT_4_TURBO,
  ChatModelDisplayNames.GPT_4_32K,
  ChatModelDisplayNames.LM_STUDIO,
]);

export const AZURE_MODELS = new Set([ChatModelDisplayNames.AZURE_OPENAI]);

export const GOOGLE_MODELS = new Set([
  ChatModelDisplayNames.GEMINI_PRO,
  ChatModelDisplayNames.GEMINI_FLASH,
]);

export const ANTHROPIC_MODELS = new Set([ChatModelDisplayNames.CLAUDE]);

export const OPENROUTERAI_MODELS = new Set([ChatModelDisplayNames.OPENROUTERAI]);

export const OLLAMA_MODELS = new Set([ChatModelDisplayNames.OLLAMA]);

export const LM_STUDIO_MODELS = new Set([ChatModelDisplayNames.LM_STUDIO]);

export const DISPLAY_NAME_TO_MODEL: Record<string, string> = {
  [ChatModelDisplayNames.GPT_4]: ChatModels.GPT_4,
  [ChatModelDisplayNames.GPT_4o]: ChatModels.GPT_4o,
  [ChatModelDisplayNames.GPT_4o_mini]: ChatModels.GPT_4o_mini,
  [ChatModelDisplayNames.GPT_4_TURBO]: ChatModels.GPT_4_TURBO,
  [ChatModelDisplayNames.GPT_4_32K]: ChatModels.GPT_4_32K,
  [ChatModelDisplayNames.AZURE_OPENAI]: "azure_openai",
  [ChatModelDisplayNames.GEMINI_PRO]: ChatModels.GEMINI_PRO,
  [ChatModelDisplayNames.GEMINI_FLASH]: ChatModels.GEMINI_FLASH,
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

export const COMMAND_IDS = {
  FIX_GRAMMAR: "fix-grammar-prompt",
  SUMMARIZE: "summarize-prompt",
  GENERATE_TOC: "generate-toc-prompt",
  GENERATE_GLOSSARY: "generate-glossary-prompt",
  SIMPLIFY: "simplify-prompt",
  EMOJIFY: "emojify-prompt",
  REMOVE_URLS: "remove-urls-prompt",
  REWRITE_TWEET: "rewrite-tweet-prompt",
  REWRITE_TWEET_THREAD: "rewrite-tweet-thread-prompt",
  MAKE_SHORTER: "make-shorter-prompt",
  MAKE_LONGER: "make-longer-prompt",
  ELI5: "eli5-prompt",
  PRESS_RELEASE: "press-release-prompt",
  TRANSLATE: "translate-selection-prompt",
  CHANGE_TONE: "change-tone-prompt",
  COUNT_TOKENS: "count-tokens",
  COUNT_TOTAL_VAULT_TOKENS: "count-total-vault-tokens",
};

export const DEFAULT_SETTINGS: CopilotSettings = {
  openAIApiKey: "",
  openAIOrgId: "",
  openAICustomModel: "",
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
  googleCustomModel: "",
  openRouterAiApiKey: "",
  openRouterModel: "cognitivecomputations/dolphin-mixtral-8x7b",
  defaultModel: ChatModels.GPT_4o,
  defaultModelDisplayName: ChatModelDisplayNames.GPT_4o,
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
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH,
  qaExclusionPaths: "",
  chatNoteContextPath: "",
  chatNoteContextTags: [],
  debug: false,
  enableEncryption: false,
  maxSourceChunks: 3,
  groqModel: "llama3-70b-8192",
  groqApiKey: "",
  enabledCommands: {
    [COMMAND_IDS.FIX_GRAMMAR]: {
      enabled: true,
      name: "Fix grammar and spelling of selection",
    },
    [COMMAND_IDS.SUMMARIZE]: {
      enabled: true,
      name: "Summarize selection",
    },
    [COMMAND_IDS.GENERATE_TOC]: {
      enabled: true,
      name: "Generate table of contents for selection",
    },
    [COMMAND_IDS.GENERATE_GLOSSARY]: {
      enabled: true,
      name: "Generate glossary for selection",
    },
    [COMMAND_IDS.SIMPLIFY]: {
      enabled: true,
      name: "Simplify selection",
    },
    [COMMAND_IDS.EMOJIFY]: {
      enabled: true,
      name: "Emojify selection",
    },
    [COMMAND_IDS.REMOVE_URLS]: {
      enabled: true,
      name: "Remove URLs from selection",
    },
    [COMMAND_IDS.REWRITE_TWEET]: {
      enabled: true,
      name: "Rewrite selection to a tweet",
    },
    [COMMAND_IDS.REWRITE_TWEET_THREAD]: {
      enabled: true,
      name: "Rewrite selection to a tweet thread",
    },
    [COMMAND_IDS.MAKE_SHORTER]: {
      enabled: true,
      name: "Make selection shorter",
    },
    [COMMAND_IDS.MAKE_LONGER]: {
      enabled: true,
      name: "Make selection longer",
    },
    [COMMAND_IDS.ELI5]: {
      enabled: true,
      name: "Explain selection like I'm 5",
    },
    [COMMAND_IDS.PRESS_RELEASE]: {
      enabled: true,
      name: "Rewrite selection to a press release",
    },
    [COMMAND_IDS.TRANSLATE]: {
      enabled: true,
      name: "Translate selection",
    },
    [COMMAND_IDS.CHANGE_TONE]: {
      enabled: true,
      name: "Change tone of selection",
    },
  },
};
