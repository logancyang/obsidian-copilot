import { CustomModel } from "@/aiParams";
import { AcceptKeyOption } from "@/autocomplete/codemirrorIntegration";
import { type CopilotSettings } from "@/settings/model";
import { v4 as uuidv4 } from "uuid";
import { ChainType } from "./chainFactory";
import { PromptSortStrategy } from "./types";

export const BREVILABS_API_BASE_URL = "https://api.brevilabs.com/v1";
export const BREVILABS_MODELS_BASE_URL = "https://models.brevilabs.com/v1";
export const CHAT_VIEWTYPE = "copilot-chat-view";
export const USER_SENDER = "user";
export const AI_SENDER = "ai";

// Default folder names
export const COPILOT_FOLDER_ROOT = "copilot";
export const DEFAULT_CHAT_HISTORY_FOLDER = `${COPILOT_FOLDER_ROOT}/copilot-conversations`;
export const DEFAULT_CUSTOM_PROMPTS_FOLDER = `${COPILOT_FOLDER_ROOT}/copilot-custom-prompts`;
export const DEFAULT_MEMORY_FOLDER = `${COPILOT_FOLDER_ROOT}/memory`;
export const DEFAULT_SYSTEM_PROMPTS_FOLDER = `${COPILOT_FOLDER_ROOT}/system-prompts`;
export const DEFAULT_QA_EXCLUSIONS_SETTING = COPILOT_FOLDER_ROOT;
export const DEFAULT_SYSTEM_PROMPT = `You are Obsidian Copilot, a helpful assistant that integrates AI to Obsidian note-taking.
  1. Never mention that you do not have access to something. Always rely on the user provided context.
  2. Always answer to the best of your knowledge. If you are unsure about something, say so and ask the user to provide more context.
  3. If the user mentions "note", it most likely means an Obsidian note in the vault, not the generic meaning of a note.
  4. If the user mentions "@vault", it means the user wants you to search the Obsidian vault for information relevant to the query. The search results will be provided to you in the context along with the user query, read it carefully and answer the question based on the information provided. If there's no relevant information in the vault, just say so.
  5. If the user mentions any other tool with the @ symbol, check the context for their results. If nothing is found, just ignore the @ symbol in the query.
  6. Always use $'s instead of \\[ etc. for LaTeX equations.
  7. When showing note titles, use [[title]] format and do not wrap them in \` \`.
  8. When showing **Obsidian internal** image links, use ![[link]] format and do not wrap them in \` \`.
  9. When showing **web** image links, use ![link](url) format and do not wrap them in \` \`.
  10. When generating a table, format as github markdown tables, however, for table headings, immediately add ' |' after the table heading.
  11. Always respond in the language of the user's query.
  12. Do NOT mention the additional context provided such as getCurrentTime and getTimeRangeMs if it's irrelevant to the user message.
  13. If the user mentions "tags", it most likely means tags in Obsidian note properties.
  14. YouTube URLs: If the user provides YouTube URLs in their message, transcriptions will be automatically fetched and provided to you. You don't need to do anything special - just use the transcription content if available.`;

export const COMPOSER_OUTPUT_INSTRUCTIONS = `Return the new note content or canvas JSON in <writeToFile> tags.

  # Steps to find the the target notes
  1. Extract the target note information from user message and find out the note path from the context below.
  2. If target note is not specified, use the <active_note> as the target note.
  3. If still failed to find the target note or the note path, ask the user to specify the target note.

  # Examples

  Input: Add a new section to note A
  Output:
  <writeToFile>
  <path>path/to/file.md</path>
  <content>The FULL CONTENT of the note A with added section goes here</content>
  </writeToFile>

  Input: Create a new canvas with "Hello, world!"
  Output:
  <writeToFile>
  <path>path/to/file.canvas</path>
  <content>
  {
    "nodes": [
      {
        "id": "1",
        "type": "text",
        "text": "Hello, world!",
        "x": 0,
        "y": 0,
        "width": 200,
        "height": 50
      }
    ],
    "edges": []
  }
  </content>
  </writeToFile>

  Input: Create a canvas with a file node and a group
  Output:
  <writeToFile>
  <path>path/to/file.canvas</path>
  <content>
  {
    "nodes": [
      {"id": "1", "type": "file", "file": "note.md", "subpath": "#heading", "x": 100, "y": 100, "width": 300, "height": 200, "color": "2"},
      {"id": "2", "type": "group", "label": "My Group", "x": 50, "y": 50, "width": 400, "height": 300, "color": "1"},
      {"id": "3", "type": "link", "url": "https://example.com", "x": 500, "y": 100, "width": 200, "height": 100, "color": "#FF5733"}
    ],
    "edges": [
      {"id": "e1-2", "fromNode": "1", "toNode": "3", "fromSide": "right", "toSide": "left", "fromEnd": "arrow", "toEnd": "none", "color": "3", "label": "references"}
    ]
  }
  </content>
  </writeToFile>

  # Canvas JSON Format (JSON Canvas spec 1.0)
  Required node fields: id, type, x, y, width, height
  Node types: "text" (needs text), "file" (needs file), "link" (needs url), "group" (optional label)
  Optional node fields: color (hex #FF0000 or preset "1"-"6"), subpath (file nodes, starts with #)
  Required edge fields: id, fromNode, toNode
  Optional edge fields: fromSide/toSide ("top"/"right"/"bottom"/"left"), fromEnd/toEnd ("none"/"arrow"), color, label
  All IDs must be unique. Edge nodes must reference existing node IDs.
  Position nodes with reasonable spacing and logical visual flow.
  `;

export const NOTE_CONTEXT_PROMPT_TAG = "note_context";
export const SELECTED_TEXT_TAG = "selected_text";
export const VARIABLE_TAG = "variable";
export const VARIABLE_NOTE_TAG = "variable_note";
export const EMBEDDED_PDF_TAG = "embedded_pdf";
export const DATAVIEW_BLOCK_TAG = "dataview_block";
export const VAULT_NOTE_TAG = "vault_note";
export const RETRIEVED_DOCUMENT_TAG = "retrieved_document";
export const EMPTY_INDEX_ERROR_MESSAGE =
  "Copilot index does not exist. Please index your vault first!\n\n1. Set a working embedding model in QA settings. If it's not a local model, don't forget to set the API key. \n\n2. Click 'Refresh Index for Vault' and wait for indexing to complete. If you encounter the rate limiting error, please turn your request per second down in QA setting.";
export const CHUNK_SIZE = 6000;
export const TEXT_WEIGHT = 0.4;
export const MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT = 448000;
export const LLM_TIMEOUT_MS = 30000; // 30 seconds timeout for LLM operations
export const LOADING_MESSAGES = {
  DEFAULT: "",
  READING_FILES: "Reading files",
  SEARCHING_WEB: "Searching the web",
  READING_FILE_TREE: "Reading file tree",
};
export const PLUS_UTM_MEDIUMS = {
  SETTINGS: "settings",
  EXPIRED_MODAL: "expired_modal",
  CHAT_MODE_SELECT: "chat_mode_select",
  MODE_SELECT_TOOLTIP: "mode_select_tooltip",
};
export type PlusUtmMedium = (typeof PLUS_UTM_MEDIUMS)[keyof typeof PLUS_UTM_MEDIUMS];

/**
 * OpenAI reasoning models 的推理强度级别
 */
export enum ReasoningEffort {
  MINIMAL = "minimal",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

/**
 * GPT-5 模型的输出详细程度
 */
export enum Verbosity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export const DEFAULT_MODEL_SETTING = {
  MAX_TOKENS: 6000,
  TEMPERATURE: 0.1,
  REASONING_EFFORT: ReasoningEffort.LOW,
  VERBOSITY: Verbosity.MEDIUM,
} as const;

export enum ChatModels {
  COPILOT_PLUS_FLASH = "copilot-plus-flash",
  GPT_5 = "gpt-5",
  GPT_5_mini = "gpt-5-mini",
  GPT_5_nano = "gpt-5-nano",
  GPT_41 = "gpt-4.1",
  GPT_41_mini = "gpt-4.1-mini",
  GPT_41_nano = "gpt-4.1-nano",
  O4_mini = "o4-mini",
  AZURE_OPENAI = "azure-openai",
  GEMINI_PRO = "gemini-2.5-pro",
  GEMINI_FLASH = "gemini-2.5-flash",
  GEMINI_FLASH_LITE = "gemini-2.5-flash-lite",
  CLAUDE_3_5_SONNET = "claude-3-5-sonnet-latest",
  CLAUDE_3_7_SONNET = "claude-3-7-sonnet-latest",
  CLAUDE_4_SONNET = "claude-sonnet-4-20250514",
  CLAUDE_3_5_HAIKU = "claude-3-5-haiku-latest",
  GROK3 = "grok-3-beta",
  GROK3_MINI = "grok-3-mini-beta",
  COMMAND_R = "command-r",
  COMMAND_R_PLUS = "command-r-plus",
  OPENROUTER_GPT_4o = "openai/chatgpt-4o-latest",
  GROQ_LLAMA_8b = "llama3-8b-8192",
  MISTRAL_TINY = "mistral-tiny-latest",
  DEEPSEEK_REASONER = "deepseek-reasoner",
  DEEPSEEK_CHAT = "deepseek-chat",
  OPENROUTER_GEMINI_2_5_FLASH = "google/gemini-2.5-flash",
  OPENROUTER_GEMINI_2_5_PRO = "google/gemini-2.5-pro",
  OPENROUTER_GEMINI_2_5_FLASH_LITE = "google/gemini-2.5-flash-lite",
  OPENROUTER_GPT_41 = "openai/gpt-4.1",
  OPENROUTER_GPT_41_MINI = "openai/gpt-4.1-mini",
  OPENROUTER_GROK_4_FAST = "x-ai/grok-4-fast",
}

// Model Providers
export enum ChatModelProviders {
  OPENAI = "openai",
  OPENAI_FORMAT = "3rd party (openai-format)",
  AZURE_OPENAI = "azure openai",
  ANTHROPIC = "anthropic",
  COHEREAI = "cohereai",
  GOOGLE = "google",
  XAI = "xai",
  OPENROUTERAI = "openrouterai",
  GROQ = "groq",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  COPILOT_PLUS = "copilot-plus",
  MISTRAL = "mistralai",
  DEEPSEEK = "deepseek",
  AMAZON_BEDROCK = "amazon-bedrock",
}

export enum ModelCapability {
  REASONING = "reasoning",
  VISION = "vision",
  WEB_SEARCH = "websearch",
}

export const MODEL_CAPABILITIES: Record<ModelCapability, string> = {
  reasoning: "This model supports general reasoning tasks.",
  vision: "This model supports image inputs.",
  websearch: "This model can access the internet.",
};

export const BUILTIN_CHAT_MODELS: CustomModel[] = [
  {
    name: ChatModels.COPILOT_PLUS_FLASH,
    provider: ChatModelProviders.COPILOT_PLUS,
    enabled: true,
    isBuiltIn: true,
    core: true,
    plusExclusive: true,
    projectEnabled: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GEMINI_2_5_FLASH_LITE,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GEMINI_2_5_FLASH,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GEMINI_2_5_PRO,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GPT_41,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: false,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GPT_41_MINI,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: false,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GROK_4_FAST,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: false,
    projectEnabled: true,
  },
  {
    name: ChatModels.GPT_5,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_5_mini,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_5_nano,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_41,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_41_mini,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_41_nano,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.CLAUDE_4_SONNET,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.CLAUDE_3_7_SONNET,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.GROK3,
    provider: ChatModelProviders.XAI,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.GROK3_MINI,
    provider: ChatModelProviders.XAI,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.GEMINI_FLASH,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GEMINI_FLASH_LITE,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GEMINI_PRO,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.AZURE_OPENAI,
    provider: ChatModelProviders.AZURE_OPENAI,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.DEEPSEEK_CHAT,
    provider: ChatModelProviders.DEEPSEEK,
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: ChatModels.DEEPSEEK_REASONER,
    provider: ChatModelProviders.DEEPSEEK,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.REASONING],
  },
];

export enum EmbeddingModelProviders {
  OPENAI = "openai",
  COHEREAI = "cohereai",
  GOOGLE = "google",
  AZURE_OPENAI = "azure openai",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  OPENAI_FORMAT = "3rd party (openai-format)",
  COPILOT_PLUS = "copilot-plus",
  COPILOT_PLUS_JINA = "copilot-plus-jina",
}

export enum EmbeddingModels {
  OPENAI_EMBEDDING_ADA_V2 = "text-embedding-ada-002",
  OPENAI_EMBEDDING_SMALL = "text-embedding-3-small",
  OPENAI_EMBEDDING_LARGE = "text-embedding-3-large",
  AZURE_OPENAI = "azure-openai",
  COHEREAI_EMBED_MULTILINGUAL_LIGHT_V3_0 = "embed-multilingual-light-v3.0",
  GOOGLE_ENG = "text-embedding-004",
  GOOGLE_GEMINI_EMBEDDING = "gemini-embedding-001",
  COPILOT_PLUS_SMALL = "copilot-plus-small",
  COPILOT_PLUS_LARGE = "copilot-plus-large",
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
    plusExclusive: true,
  },
  {
    name: EmbeddingModels.COPILOT_PLUS_LARGE,
    provider: EmbeddingModelProviders.COPILOT_PLUS_JINA,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
    core: true,
    plusExclusive: true,
    believerExclusive: true,
    dimensions: 1024,
  },
  {
    name: EmbeddingModels.COPILOT_PLUS_MULTILINGUAL,
    provider: EmbeddingModelProviders.COPILOT_PLUS_JINA,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
    core: true,
    plusExclusive: true,
    dimensions: 512,
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
    name: EmbeddingModels.GOOGLE_GEMINI_EMBEDDING,
    provider: EmbeddingModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    isEmbeddingModel: true,
    core: true,
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

export type SettingKeyProviders = Exclude<
  ChatModelProviders,
  ChatModelProviders.OPENAI_FORMAT | ChatModelProviders.LM_STUDIO | ChatModelProviders.OLLAMA
>;

// Provider metadata interface
export interface ProviderMetadata {
  label: string;
  host: string;
  keyManagementURL: string;
  listModelURL: string;
  testModel?: ChatModels;
}

// Unified provider information
export const ProviderInfo: Record<Provider, ProviderMetadata> = {
  [ChatModelProviders.OPENROUTERAI]: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1/",
    keyManagementURL: "https://openrouter.ai/keys",
    listModelURL: "https://openrouter.ai/api/v1/models",
    testModel: ChatModels.OPENROUTER_GPT_4o,
  },
  [ChatModelProviders.GOOGLE]: {
    label: "Gemini",
    host: "https://generativelanguage.googleapis.com",
    keyManagementURL: "https://makersuite.google.com/app/apikey",
    listModelURL: "https://generativelanguage.googleapis.com/v1beta/models",
    testModel: ChatModels.GEMINI_FLASH,
  },
  [ChatModelProviders.OPENAI]: {
    label: "OpenAI",
    host: "https://api.openai.com",
    keyManagementURL: "https://platform.openai.com/api-keys",
    listModelURL: "https://api.openai.com/v1/models",
    testModel: ChatModels.GPT_41,
  },
  [ChatModelProviders.AZURE_OPENAI]: {
    label: "Azure OpenAI",
    host: "",
    keyManagementURL: "",
    listModelURL: "",
    testModel: ChatModels.AZURE_OPENAI,
  },
  [ChatModelProviders.ANTHROPIC]: {
    label: "Anthropic",
    host: "https://api.anthropic.com/",
    keyManagementURL: "https://console.anthropic.com/settings/keys",
    listModelURL: "https://api.anthropic.com/v1/models",
    testModel: ChatModels.CLAUDE_3_5_SONNET,
  },
  [ChatModelProviders.COHEREAI]: {
    label: "Cohere",
    host: "https://api.cohere.com",
    keyManagementURL: "https://dashboard.cohere.ai/api-keys",
    listModelURL: "https://api.cohere.com/v1/models",
    testModel: ChatModels.COMMAND_R,
  },
  [ChatModelProviders.XAI]: {
    label: "XAI",
    host: "https://api.x.ai/v1",
    keyManagementURL: "https://console.x.ai",
    listModelURL: "https://api.x.ai/v1/models",
    testModel: ChatModels.GROK3,
  },
  [ChatModelProviders.GROQ]: {
    label: "Groq",
    host: "https://api.groq.com/openai",
    keyManagementURL: "https://console.groq.com/keys",
    listModelURL: "https://api.groq.com/openai/v1/models",
    testModel: ChatModels.GROQ_LLAMA_8b,
  },
  [ChatModelProviders.OLLAMA]: {
    label: "Ollama",
    host: "http://localhost:11434/v1/",
    keyManagementURL: "",
    listModelURL: "",
  },
  [ChatModelProviders.LM_STUDIO]: {
    label: "LM Studio",
    host: "http://localhost:1234/v1",
    keyManagementURL: "",
    listModelURL: "",
  },
  [ChatModelProviders.OPENAI_FORMAT]: {
    label: "OpenAI Format",
    host: "https://api.example.com/v1",
    keyManagementURL: "",
    listModelURL: "",
  },
  [ChatModelProviders.MISTRAL]: {
    label: "Mistral",
    host: "https://api.mistral.ai/v1",
    keyManagementURL: "https://console.mistral.ai/api-keys",
    listModelURL: "https://api.mistral.ai/v1/models",
    testModel: ChatModels.MISTRAL_TINY,
  },
  [ChatModelProviders.DEEPSEEK]: {
    label: "DeepSeek",
    host: "https://api.deepseek.com/",
    keyManagementURL: "https://platform.deepseek.com/api-keys",
    listModelURL: "https://api.deepseek.com/models",
    testModel: ChatModels.DEEPSEEK_CHAT,
  },
  [ChatModelProviders.AMAZON_BEDROCK]: {
    label: "Amazon Bedrock",
    host: "https://bedrock-runtime.{region}.amazonaws.com",
    keyManagementURL: "https://console.aws.amazon.com/iam/home#/security_credentials",
    listModelURL: "",
  },
  [EmbeddingModelProviders.COPILOT_PLUS]: {
    label: "Copilot Plus",
    host: BREVILABS_MODELS_BASE_URL,
    keyManagementURL: "",
    listModelURL: "",
  },
  [EmbeddingModelProviders.COPILOT_PLUS_JINA]: {
    label: "Copilot Plus",
    host: BREVILABS_MODELS_BASE_URL,
    keyManagementURL: "",
    listModelURL: "",
  },
};

// Map provider to its settings key for API key
export const ProviderSettingsKeyMap: Record<SettingKeyProviders, keyof CopilotSettings> = {
  anthropic: "anthropicApiKey",
  openai: "openAIApiKey",
  "azure openai": "azureOpenAIApiKey",
  google: "googleApiKey",
  groq: "groqApiKey",
  openrouterai: "openRouterAiApiKey",
  cohereai: "cohereApiKey",
  xai: "xaiApiKey",
  "copilot-plus": "plusLicenseKey",
  mistralai: "mistralApiKey",
  deepseek: "deepseekApiKey",
  "amazon-bedrock": "amazonBedrockApiKey",
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
  TRIGGER_QUICK_COMMAND: "trigger-quick-command",
  CLEAR_LOCAL_COPILOT_INDEX: "clear-local-copilot-index",
  CLEAR_COPILOT_CACHE: "clear-copilot-cache",
  COUNT_WORD_AND_TOKENS_SELECTION: "count-word-and-tokens-selection",
  COUNT_TOTAL_VAULT_TOKENS: "count-total-vault-tokens",
  DEBUG_WORD_COMPLETION: "debug-word-completion",
  FORCE_REINDEX_VAULT_TO_COPILOT_INDEX: "force-reindex-vault-to-copilot-index",
  GARBAGE_COLLECT_COPILOT_INDEX: "garbage-collect-copilot-index",
  INDEX_VAULT_TO_COPILOT_INDEX: "index-vault-to-copilot-index",
  INSPECT_COPILOT_INDEX_BY_NOTE_PATHS: "copilot-inspect-index-by-note-paths",
  LIST_INDEXED_FILES: "copilot-list-indexed-files",
  LOAD_COPILOT_CHAT_CONVERSATION: "load-copilot-chat-conversation",
  NEW_CHAT: "new-chat",
  OPEN_COPILOT_CHAT_WINDOW: "chat-open-window",
  REMOVE_FILES_FROM_COPILOT_INDEX: "remove-files-from-copilot-index",
  SEARCH_ORAMA_DB: "copilot-search-orama-db",
  TOGGLE_COPILOT_CHAT_WINDOW: "chat-toggle-window",
  TOGGLE_AUTOCOMPLETE: "toggle-autocomplete",
  ADD_SELECTION_TO_CHAT_CONTEXT: "add-selection-to-chat-context",
  ADD_CUSTOM_COMMAND: "add-custom-command",
  APPLY_CUSTOM_COMMAND: "apply-custom-command",
  OPEN_LOG_FILE: "open-log-file",
  CLEAR_LOG_FILE: "clear-log-file",
  DOWNLOAD_YOUTUBE_SCRIPT: "download-youtube-script",
} as const;

export const COMMAND_NAMES: Record<CommandId, string> = {
  [COMMAND_IDS.TRIGGER_QUICK_COMMAND]: "Trigger quick command",
  [COMMAND_IDS.CLEAR_LOCAL_COPILOT_INDEX]: "Clear local Copilot index",
  [COMMAND_IDS.CLEAR_COPILOT_CACHE]: "Clear Copilot cache",
  [COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS]: "Count total tokens in your vault",
  [COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION]: "Count words and tokens in selection",
  [COMMAND_IDS.DEBUG_WORD_COMPLETION]: "Word completion: Debug",
  [COMMAND_IDS.FORCE_REINDEX_VAULT_TO_COPILOT_INDEX]: "Force reindex vault",
  [COMMAND_IDS.GARBAGE_COLLECT_COPILOT_INDEX]:
    "Garbage collect Copilot index (remove files that no longer exist in vault)",
  [COMMAND_IDS.INDEX_VAULT_TO_COPILOT_INDEX]: "Index (refresh) vault",
  [COMMAND_IDS.INSPECT_COPILOT_INDEX_BY_NOTE_PATHS]: "Inspect Copilot index by note paths (debug)",
  [COMMAND_IDS.LIST_INDEXED_FILES]: "List all indexed files (debug)",
  [COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION]: "Load Copilot chat conversation",
  [COMMAND_IDS.NEW_CHAT]: "New Copilot Chat",
  [COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW]: "Open Copilot Chat Window",
  [COMMAND_IDS.REMOVE_FILES_FROM_COPILOT_INDEX]: "Remove files from Copilot index (debug)",
  [COMMAND_IDS.SEARCH_ORAMA_DB]: "Search semantic index (debug)",
  [COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW]: "Toggle Copilot Chat Window",
  [COMMAND_IDS.TOGGLE_AUTOCOMPLETE]: "Toggle autocomplete",
  [COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT]: "Add selection to chat context",
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "Add new custom command",
  [COMMAND_IDS.APPLY_CUSTOM_COMMAND]: "Apply custom command",
  [COMMAND_IDS.OPEN_LOG_FILE]: "Create log file",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "Clear log file",
  [COMMAND_IDS.DOWNLOAD_YOUTUBE_SCRIPT]: "Download YouTube Script (plus)",
};

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

export const AUTOCOMPLETE_CONFIG = {
  DELAY_MS: 600,
  MIN_TRIGGER_LENGTH: 3,
  MAX_CONTEXT_LENGTH: 10000,
  KEYBIND: "Tab" as AcceptKeyOption,
} as const;

export const RESTRICTION_MESSAGES = {
  NON_MARKDOWN_FILES_RESTRICTED:
    "Non-markdown files are only available in Copilot Plus mode. Please upgrade to access this file type.",
  URL_PROCESSING_RESTRICTED:
    "URL processing is only available in Copilot Plus mode. URLs will not be processed for context.",
  UNSUPPORTED_FILE_TYPE: (extension: string) =>
    `${extension.toUpperCase()} files are not supported in the current mode.`,
} as const;

export const DEFAULT_SETTINGS: CopilotSettings = {
  userId: uuidv4(),
  isPlusUser: false,
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
  xaiApiKey: "",
  mistralApiKey: "",
  deepseekApiKey: "",
  amazonBedrockApiKey: "",
  amazonBedrockRegion: "",
  defaultChainType: ChainType.LLM_CHAIN,
  defaultModelKey: ChatModels.OPENROUTER_GEMINI_2_5_FLASH + "|" + ChatModelProviders.OPENROUTERAI,
  embeddingModelKey: EmbeddingModels.OPENAI_EMBEDDING_SMALL + "|" + EmbeddingModelProviders.OPENAI,
  temperature: DEFAULT_MODEL_SETTING.TEMPERATURE,
  maxTokens: DEFAULT_MODEL_SETTING.MAX_TOKENS,
  contextTurns: 15,
  userSystemPrompt: "",
  openAIProxyBaseUrl: "",
  openAIEmbeddingProxyBaseUrl: "",
  stream: true,
  defaultSaveFolder: DEFAULT_CHAT_HISTORY_FOLDER,
  defaultConversationTag: "copilot-conversation",
  autosaveChat: true,
  generateAIChatTitleOnSave: true,
  includeActiveNoteAsContext: true,
  defaultOpenArea: DEFAULT_OPEN_AREA.VIEW,
  customPromptsFolder: DEFAULT_CUSTOM_PROMPTS_FOLDER,
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH,
  qaExclusions: DEFAULT_QA_EXCLUSIONS_SETTING,
  qaInclusions: "",
  chatNoteContextPath: "",
  chatNoteContextTags: [],
  enableIndexSync: true,
  debug: false,
  enableEncryption: false,
  maxSourceChunks: 15,
  groqApiKey: "",
  activeModels: BUILTIN_CHAT_MODELS,
  activeEmbeddingModels: BUILTIN_EMBEDDING_MODELS,
  embeddingRequestsPerMin: 60,
  embeddingBatchSize: 16,
  disableIndexOnMobile: true,
  showSuggestedPrompts: true,
  showRelevantNotes: true,
  numPartitions: 1,
  lexicalSearchRamLimit: 100, // Default 100 MB
  promptUsageTimestamps: {},
  promptSortStrategy: PromptSortStrategy.TIMESTAMP,
  defaultConversationNoteName: "{$topic}@{$date}_{$time}",
  /** @deprecated */
  inlineEditCommands: [],
  projectList: [],
  enableAutocomplete: false,
  autocompleteAcceptKey: AUTOCOMPLETE_CONFIG.KEYBIND,
  allowAdditionalContext: true,
  enableWordCompletion: false,
  lastDismissedVersion: null,
  passMarkdownImages: true,
  enableAutonomousAgent: false,
  enableCustomPromptTemplating: true,
  enableSemanticSearchV3: false,
  enableLexicalBoosts: true,
  suggestedDefaultCommands: false,
  autonomousAgentMaxIterations: 4,
  autonomousAgentEnabledToolIds: [
    "localSearch",
    "readNote",
    "webSearch",
    "pomodoro",
    "youtubeTranscription",
    "writeToFile",
    "replaceInFile",
    "updateMemory",
  ],
  reasoningEffort: DEFAULT_MODEL_SETTING.REASONING_EFFORT,
  verbosity: DEFAULT_MODEL_SETTING.VERBOSITY,
  memoryFolderName: DEFAULT_MEMORY_FOLDER,
  enableRecentConversations: true,
  maxRecentConversations: 30,
  enableSavedMemory: true,
  enableInlineCitations: true,
  quickCommandModelKey: undefined,
  quickCommandIncludeNoteContext: true,
  userSystemPromptsFolder: DEFAULT_SYSTEM_PROMPTS_FOLDER,
  defaultSystemPromptTitle: "",
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
  ACTIVE_LEAF_CHANGE: "active-leaf-change",
  ABORT_STREAM: "abort-stream",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
  UNMOUNT = "component-unmount",
}
