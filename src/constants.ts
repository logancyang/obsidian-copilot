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
  7. When showing note titles, use [[title]] format and do not wrap them in \` \`.
  8. When showing image links, use ![[link]] format and do not wrap them in \` \`.
  9. Always respond in the language of the user's query.
  Do not mention the additional context provided if it's irrelevant to the user message.`;
export const EMPTY_INDEX_ERROR_MESSAGE =
  "Copilot index does not exist. Please index your vault first!\n\n1. Set a working embedding model in QA settings. If it's not a local model, don't forget to set the API key. \n\n2. Click 'Refresh Index for Vault' and wait for indexing to complete. If you encounter the rate limiting error, please turn your request per second down in QA setting.";
export const CHUNK_SIZE = 4000;
export const CONTEXT_SCORE_THRESHOLD = 0.4;
export const TEXT_WEIGHT = 0.4;
export const PLUS_MODE_DEFAULT_SOURCE_CHUNKS = 15;
export const MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT = 512000;
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
  OPENROUTER_GPT_4o = "openai/chatgpt-4o-latest",
  GROQ_LLAMA_8b = "llama3-8b-8192",
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
  // AZURE_OPENAI = "azure_openai",
  AZURE_OPENAI = "azure openai",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  OPENAI_FORMAT = "3rd party (openai-format)",
  COPILOT_PLUS = "copilot-plus",
  COPILOT_PLUS_JINA = "copilot-plus-jina",
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
  COPILOT_PLUS_SMALL = "copilot-plus-small",
  COPILOT_PLUS_MULTILINGUAL = "copilot-plus-multilingual",
}

export const BUILTIN_EMBEDDING_MODELS: CustomModel[] = [
  {
    name: EmbeddingModels.COPILOT_PLUS_SMALL,
    provider: EmbeddingModelProviders.COPILOT_PLUS,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
    core: true,
  },
  {
    name: EmbeddingModels.COPILOT_PLUS_MULTILINGUAL,
    provider: EmbeddingModelProviders.COPILOT_PLUS_JINA,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
    core: true,
  },
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

export type Provider = ChatModelProviders | EmbeddingModelProviders;

export type DisplayKeyProviders = Exclude<
  ChatModelProviders,
  ChatModelProviders.OPENAI_FORMAT | ChatModelProviders.LM_STUDIO | ChatModelProviders.OLLAMA
>;

// Provider metadata interface
export interface ProviderMetadata {
  label: string;
  host: string;
  keyManagementURL: string;
  testModel?: ChatModels;
}

// Unified provider information
export const ProviderInfo: Record<Provider, ProviderMetadata> = {
  [ChatModelProviders.OPENAI]: {
    label: "OpenAI",
    host: "https://api.openai.com",
    keyManagementURL: "https://platform.openai.com/api-keys",
    testModel: ChatModels.GPT_4o,
  },
  [ChatModelProviders.AZURE_OPENAI]: {
    label: "Azure OpenAI",
    host: "",
    keyManagementURL: "",
    testModel: ChatModels.AZURE_OPENAI,
  },
  [ChatModelProviders.ANTHROPIC]: {
    label: "Anthropic",
    host: "https://api.anthropic.com/",
    keyManagementURL: "https://console.anthropic.com/settings/keys",
    testModel: ChatModels.CLAUDE_3_5_SONNET,
  },
  [ChatModelProviders.COHEREAI]: {
    label: "Cohere",
    host: "https://api.cohere.com",
    keyManagementURL: "https://dashboard.cohere.ai/api-keys",
    testModel: ChatModels.COMMAND_R,
  },
  [ChatModelProviders.GOOGLE]: {
    label: "Gemini",
    host: "https://generativelanguage.googleapis.com",
    keyManagementURL: "https://makersuite.google.com/app/apikey",
    testModel: ChatModels.GEMINI_FLASH,
  },
  [ChatModelProviders.OPENROUTERAI]: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1/",
    keyManagementURL: "https://openrouter.ai/keys",
    testModel: ChatModels.OPENROUTER_GPT_4o,
  },
  [ChatModelProviders.GROQ]: {
    label: "Groq",
    host: "https://api.groq.com/openai",
    keyManagementURL: "https://console.groq.com/keys",
    testModel: ChatModels.GROQ_LLAMA_8b,
  },
  [ChatModelProviders.OLLAMA]: {
    label: "Ollama",
    host: "http://localhost:11434/v1/",
    keyManagementURL: "",
  },
  [ChatModelProviders.LM_STUDIO]: {
    label: "LM Studio",
    host: "http://localhost:1234/v1",
    keyManagementURL: "",
  },
  [ChatModelProviders.OPENAI_FORMAT]: {
    label: "OpenAI Format",
    host: "https://api.example.com/v1",
    keyManagementURL: "",
  },
  [EmbeddingModelProviders.COPILOT_PLUS]: {
    label: "Copilot Plus",
    host: "https://api.brevilabs.com/v1",
    keyManagementURL: "",
  },
  [EmbeddingModelProviders.COPILOT_PLUS_JINA]: {
    label: "Copilot Plus",
    host: "https://api.brevilabs.com/v1",
    keyManagementURL: "",
  },
};

// Map provider to its settings key for API key
export const ProviderSettingsKeyMap: Record<DisplayKeyProviders, keyof CopilotSettings> = {
  anthropic: "anthropicApiKey",
  openai: "openAIApiKey",
  "azure openai": "azureOpenAIApiKey",
  google: "googleApiKey",
  groq: "groqApiKey",
  openrouterai: "openRouterAiApiKey",
  cohereai: "cohereApiKey",
};

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
  ADD_CUSTOM_PROMPT: "add-custom-prompt",
  APPLY_ADHOC_PROMPT: "apply-adhoc-prompt",
  APPLY_CUSTOM_PROMPT: "apply-custom-prompt",
  CHANGE_TONE: "change-tone-prompt",
  CLEAR_LOCAL_COPILOT_INDEX: "clear-local-copilot-index",
  COUNT_WORD_AND_TOKENS_SELECTION: "count-word-and-tokens-selection",
  COUNT_TOTAL_VAULT_TOKENS: "count-total-vault-tokens",
  DELETE_CUSTOM_PROMPT: "delete-custom-prompt",
  EDIT_CUSTOM_PROMPT: "edit-custom-prompt",
  ELI5: "eli5-prompt",
  EMOJIFY: "emojify-prompt",
  FIND_RELEVANT_NOTES: "find-relevant-notes",
  FIX_GRAMMAR: "fix-grammar-prompt",
  FORCE_REINDEX_VAULT_TO_COPILOT_INDEX: "force-reindex-vault-to-copilot-index",
  GARBAGE_COLLECT_COPILOT_INDEX: "garbage-collect-copilot-index",
  GENERATE_GLOSSARY: "generate-glossary-prompt",
  GENERATE_TOC: "generate-toc-prompt",
  INDEX_VAULT_TO_COPILOT_INDEX: "index-vault-to-copilot-index",
  INSPECT_COPILOT_INDEX_BY_NOTE_PATHS: "copilot-inspect-index-by-note-paths",
  LIST_INDEXED_FILES: "copilot-list-indexed-files",
  LOAD_COPILOT_CHAT_CONVERSATION: "load-copilot-chat-conversation",
  MAKE_LONGER: "make-longer-prompt",
  MAKE_SHORTER: "make-shorter-prompt",
  OPEN_COPILOT_CHAT_WINDOW: "chat-open-window",
  PRESS_RELEASE: "press-release-prompt",
  REMOVE_FILES_FROM_COPILOT_INDEX: "remove-files-from-copilot-index",
  REMOVE_URLS: "remove-urls-prompt",
  REWRITE_TWEET: "rewrite-tweet-prompt",
  REWRITE_TWEET_THREAD: "rewrite-tweet-thread-prompt",
  SEARCH_ORAMA_DB: "copilot-search-orama-db",
  SIMPLIFY: "simplify-prompt",
  SUMMARIZE: "summarize-prompt",
  TOGGLE_COPILOT_CHAT_WINDOW: "chat-toggle-window",
  TRANSLATE: "translate-selection-prompt",
} as const;

export const COMMAND_NAMES: Record<CommandId, string> = {
  [COMMAND_IDS.ADD_CUSTOM_PROMPT]: "Add custom prompt",
  [COMMAND_IDS.APPLY_ADHOC_PROMPT]: "Apply ad-hoc custom prompt",
  [COMMAND_IDS.APPLY_CUSTOM_PROMPT]: "Apply custom prompt",
  [COMMAND_IDS.CHANGE_TONE]: "Change tone of selection",
  [COMMAND_IDS.CLEAR_LOCAL_COPILOT_INDEX]: "Clear local Copilot index",
  [COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS]: "Count total tokens in your vault",
  [COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION]: "Count words and tokens in selection",
  [COMMAND_IDS.DELETE_CUSTOM_PROMPT]: "Delete custom prompt",
  [COMMAND_IDS.EDIT_CUSTOM_PROMPT]: "Edit custom prompt",
  [COMMAND_IDS.ELI5]: "Explain selection like I'm 5",
  [COMMAND_IDS.EMOJIFY]: "Emojify selection",
  [COMMAND_IDS.FIND_RELEVANT_NOTES]: "Find relevant notes",
  [COMMAND_IDS.FIX_GRAMMAR]: "Fix grammar and spelling of selection",
  [COMMAND_IDS.FORCE_REINDEX_VAULT_TO_COPILOT_INDEX]: "Force reindex vault",
  [COMMAND_IDS.GARBAGE_COLLECT_COPILOT_INDEX]:
    "Garbage collect Copilot index (remove files that no longer exist in vault)",
  [COMMAND_IDS.GENERATE_GLOSSARY]: "Generate glossary for selection",
  [COMMAND_IDS.GENERATE_TOC]: "Generate table of contents for selection",
  [COMMAND_IDS.INDEX_VAULT_TO_COPILOT_INDEX]: "Index (refresh) vault",
  [COMMAND_IDS.INSPECT_COPILOT_INDEX_BY_NOTE_PATHS]: "Inspect Copilot index by note paths (debug)",
  [COMMAND_IDS.LIST_INDEXED_FILES]: "List all indexed files (debug)",
  [COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION]: "Load Copilot chat conversation",
  [COMMAND_IDS.MAKE_LONGER]: "Make selection longer",
  [COMMAND_IDS.MAKE_SHORTER]: "Make selection shorter",
  [COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW]: "Open Copilot Chat Window",
  [COMMAND_IDS.PRESS_RELEASE]: "Rewrite selection to a press release",
  [COMMAND_IDS.REMOVE_FILES_FROM_COPILOT_INDEX]: "Remove files from Copilot index (debug)",
  [COMMAND_IDS.REMOVE_URLS]: "Remove URLs from selection",
  [COMMAND_IDS.REWRITE_TWEET]: "Rewrite selection to a tweet",
  [COMMAND_IDS.REWRITE_TWEET_THREAD]: "Rewrite selection to a tweet thread",
  [COMMAND_IDS.SEARCH_ORAMA_DB]: "Search OramaDB (debug)",
  [COMMAND_IDS.SIMPLIFY]: "Simplify selection",
  [COMMAND_IDS.SUMMARIZE]: "Summarize selection",
  [COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW]: "Toggle Copilot Chat Window",
  [COMMAND_IDS.TRANSLATE]: "Translate selection",
};

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

// Commands that can be disabled by the user in settings.
export const DISABLEABLE_COMMANDS = [
  COMMAND_IDS.FIX_GRAMMAR,
  COMMAND_IDS.SUMMARIZE,
  COMMAND_IDS.GENERATE_TOC,
  COMMAND_IDS.GENERATE_GLOSSARY,
  COMMAND_IDS.SIMPLIFY,
  COMMAND_IDS.EMOJIFY,
  COMMAND_IDS.REMOVE_URLS,
  COMMAND_IDS.REWRITE_TWEET,
  COMMAND_IDS.REWRITE_TWEET_THREAD,
  COMMAND_IDS.MAKE_SHORTER,
  COMMAND_IDS.MAKE_LONGER,
  COMMAND_IDS.ELI5,
  COMMAND_IDS.PRESS_RELEASE,
  COMMAND_IDS.TRANSLATE,
  COMMAND_IDS.CHANGE_TONE,
];

// Commands to show in the context menu
export const CONTEXT_MENU_COMMANDS = [
  COMMAND_IDS.SUMMARIZE,
  COMMAND_IDS.FIX_GRAMMAR,
  COMMAND_IDS.SIMPLIFY,
  COMMAND_IDS.EMOJIFY,
  COMMAND_IDS.MAKE_LONGER,
  COMMAND_IDS.MAKE_SHORTER,
  COMMAND_IDS.TRANSLATE,
];

// Commands that process the selection
export const PROCESS_SELECTION_COMMANDS = [
  COMMAND_IDS.FIX_GRAMMAR,
  COMMAND_IDS.SUMMARIZE,
  COMMAND_IDS.GENERATE_TOC,
  COMMAND_IDS.GENERATE_GLOSSARY,
  COMMAND_IDS.SIMPLIFY,
  COMMAND_IDS.EMOJIFY,
  COMMAND_IDS.REMOVE_URLS,
  COMMAND_IDS.REWRITE_TWEET,
  COMMAND_IDS.REWRITE_TWEET_THREAD,
  COMMAND_IDS.MAKE_SHORTER,
  COMMAND_IDS.MAKE_LONGER,
  COMMAND_IDS.ELI5,
  COMMAND_IDS.PRESS_RELEASE,
  COMMAND_IDS.TRANSLATE,
  COMMAND_IDS.CHANGE_TONE,
];

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
  embeddingModelKey:
    EmbeddingModels.COPILOT_PLUS_SMALL + "|" + EmbeddingModelProviders.COPILOT_PLUS,
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
  showRelevantNotes: true,
  numPartitions: 1,
  enabledCommands: {},
  promptUsageTimestamps: {},
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
  ACTIVE_LEAF_CHANGE: "active-leaf-change",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
}
