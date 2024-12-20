import { CustomModel } from "@/aiParams";
import { type CopilotSettings } from "@/settings/model";
import { ChainType } from "./chainFactory";

export const BREVILABS_API_BASE_URL = "https://api.brevilabs.com/v1";
export const CHAT_VIEWTYPE = "copilot-chat-view";
export const USER_SENDER = "user";
export const AI_SENDER = "ai";
export const DEFAULT_SYSTEM_PROMPT = `You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.
  1. Never mention that you do not have access to something. Always rely on the user provided context.
  2. Always answer to the best of your knowledge. If you are unsure about something, say so and ask the user to provide more context.
  3. If the user mentions "note", it most likely means an Obsidian note in the vault, not the generic meaning of a note.
  4. If the user mentions "@vault", it means the user wants you to search the Obsidian vault for information relevant to the query. The search results will be provided to you in the context. If there's no relevant information in the vault, just say so.
  5. If the user mentions any other tool with the @ symbol, check the context for their results. If nothing is found, just ignore the @ symbol in the query.
  6. Always use $'s instead of \\[ etc. for LaTeX equations.
  7. Always respond in the language of the user's query.
  Do not mention the additional context provided if it's irrelevant to the user message.`;
export const EMPTY_INDEX_ERROR_MESSAGE =
  "Copilot index does not exist. Please index your vault first!\n\n1. Set a working embedding model in QA settings. If it's not a local model, don't forget to set the API key. \n\n2. Click 'Refresh Index for Vault' and wait for indexing to complete. If you encounter the rate limiting error, please turn your request per second down in QA setting.";
export const CHUNK_SIZE = 4000;
export const CONTEXT_SCORE_THRESHOLD = 0.4;
export const TEXT_WEIGHT = 0.4;
export const LOADING_MESSAGES = {
  DEFAULT: "",
  READING_FILES: "Reading files",
  SEARCHING_WEB: "Searching the web",
};

export enum ChatModels {
  GPT_4o = "gpt-4o",
  GPT_4o_mini = "gpt-4o-mini",
  GPT_4_TURBO = "gpt-4-turbo",
  GEMINI_PRO = "gemini-1.5-pro",
  GEMINI_FLASH = "gemini-1.5-flash",
  AZURE_OPENAI = "azure-openai",
  CLAUDE_3_5_SONNET = "claude-3-5-sonnet-latest",
  CLAUDE_3_5_HAIKU = "claude-3-5-haiku-latest",
  COMMAND_R = "command-r",
  COMMAND_R_PLUS = "command-r-plus",
}

// Model Providers
export enum ChatModelProviders {
  OPENAI = "openai",
  AZURE_OPENAI = "azure openai",
  ANTHROPIC = "anthropic",
  COHEREAI = "cohereai",
  GOOGLE = "google",
  OPENROUTERAI = "openrouterai",
  GROQ = "groq",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  OPENAI_FORMAT = "3rd party (openai-format)",
}

export const BUILTIN_CHAT_MODELS: CustomModel[] = [
  {
    name: ChatModels.GPT_4o,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
  },
  {
    name: ChatModels.GPT_4o_mini,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
  },
  {
    name: ChatModels.GPT_4_TURBO,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.CLAUDE_3_5_SONNET,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
    core: true,
  },
  {
    name: ChatModels.CLAUDE_3_5_HAIKU,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.COMMAND_R,
    provider: ChatModelProviders.COHEREAI,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.COMMAND_R_PLUS,
    provider: ChatModelProviders.COHEREAI,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.GEMINI_PRO,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.GEMINI_FLASH,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.AZURE_OPENAI,
    provider: ChatModelProviders.AZURE_OPENAI,
    enabled: true,
    isBuiltIn: true,
  },
];

export enum EmbeddingModelProviders {
  OPENAI = "openai",
  COHEREAI = "cohereai",
  GOOGLE = "google",
  AZURE_OPENAI = "azure_openai",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  OPENAI_FORMAT = "3rd party (openai-format)",
  // HUGGINGFACE = "huggingface",
  // VOYAGEAI = "voyageai",
}

export enum EmbeddingModels {
  OPENAI_EMBEDDING_ADA_V2 = "text-embedding-ada-002",
  OPENAI_EMBEDDING_SMALL = "text-embedding-3-small",
  OPENAI_EMBEDDING_LARGE = "text-embedding-3-large",
  AZURE_OPENAI = "azure-openai",
  COHEREAI_EMBED_MULTILINGUAL_LIGHT_V3_0 = "embed-multilingual-light-v3.0",
  GOOGLE_ENG = "text-embedding-004",
}

export const BUILTIN_EMBEDDING_MODELS: CustomModel[] = [
  {
    name: EmbeddingModels.OPENAI_EMBEDDING_SMALL,
    provider: EmbeddingModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
    core: true,
  },
  {
    name: EmbeddingModels.OPENAI_EMBEDDING_LARGE,
    provider: EmbeddingModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
  },
  {
    name: EmbeddingModels.COHEREAI_EMBED_MULTILINGUAL_LIGHT_V3_0,
    provider: EmbeddingModelProviders.COHEREAI,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
  },
  {
    name: EmbeddingModels.GOOGLE_ENG,
    provider: EmbeddingModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
  },
  {
    name: EmbeddingModels.AZURE_OPENAI,
    provider: EmbeddingModelProviders.AZURE_OPENAI,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
  },
];

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

export enum DEFAULT_OPEN_AREA {
  EDITOR = "editor",
  VIEW = "view",
}

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
  plusLicenseKey: "",
  openAIApiKey: "",
  openAIOrgId: "",
  huggingfaceApiKey: "",
  cohereApiKey: "",
  anthropicApiKey: "",
  azureOpenAIApiKey: "",
  azureOpenAIApiInstanceName: "",
  azureOpenAIApiDeploymentName: "",
  azureOpenAIApiVersion: "",
  azureOpenAIApiEmbeddingDeploymentName: "",
  googleApiKey: "",
  openRouterAiApiKey: "",
  defaultChainType: ChainType.LLM_CHAIN,
  defaultModelKey: ChatModels.GPT_4o + "|" + ChatModelProviders.OPENAI,
  embeddingModelKey: EmbeddingModels.OPENAI_EMBEDDING_SMALL + "|" + ChatModelProviders.OPENAI,
  temperature: 0.1,
  maxTokens: 1000,
  contextTurns: 15,
  userSystemPrompt: "",
  openAIProxyBaseUrl: "",
  openAIEmbeddingProxyBaseUrl: "",
  stream: true,
  defaultSaveFolder: "copilot-conversations",
  defaultConversationTag: "copilot-conversation",
  autosaveChat: false,
  defaultOpenArea: DEFAULT_OPEN_AREA.VIEW,
  customPromptsFolder: "copilot-custom-prompts",
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH,
  qaExclusions: "",
  qaInclusions: "",
  chatNoteContextPath: "",
  chatNoteContextTags: [],
  enableIndexSync: true,
  debug: false,
  enableEncryption: false,
  maxSourceChunks: 3,
  groqApiKey: "",
  activeModels: BUILTIN_CHAT_MODELS,
  activeEmbeddingModels: BUILTIN_EMBEDDING_MODELS,
  embeddingRequestsPerSecond: 10,
  disableIndexOnMobile: true,
  showSuggestedPrompts: true,
  numPartitions: 1,
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
  promptUsageTimestamps: {},
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
}
