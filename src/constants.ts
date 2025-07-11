import { CustomModel } from "@/aiParams";
import { AcceptKeyOption } from "@/autocomplete/codemirrorIntegration";
import { type CopilotSettings } from "@/settings/model";
import { v4 as uuidv4 } from "uuid";
import { ChainType } from "./chainFactory";
import { PromptSortStrategy } from "./types";

export const BREVILABS_API_BASE_URL = "https://api.brevilabs.com/v1";
export const CHAT_VIEWTYPE = "copilot-chat-view";
export const USER_SENDER = "user";
export const AI_SENDER = "ai";

// Default folder names
export const DEFAULT_CHAT_HISTORY_FOLDER = "copilot-conversations";
export const DEFAULT_CUSTOM_PROMPTS_FOLDER = "copilot-custom-prompts";
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
  10. When generating a table, use compact formatting without excessive whitespace.
  11. Always respond in the language of the user's query.
  12. Do NOT mention the additional context provided such as getCurrentTime and getTimeRangeMs if it's irrelevant to the user message.
  13. If the user mentions "tags", it most likely means tags in Obsidian note properties.`;

export const COMPOSER_OUTPUT_INSTRUCTIONS = `Return the new note content or canvas JSON in a special JSON format.

  # Steps to find the the target notes
  1. Extract the target note information from user message and find out the note path from the context below.
  2. If target note is not specified, use the <active_note> as the target note.
  3. If still failed to find the target note or the note path, ask the user to specify the target note.

  # JSON Format
  Provide the content in JSON format and wrap it in a code block with the following structure:

  For a single markdown file:
  \`\`\`json
  {
    "type": "composer",
    "path": "path/to/file.md",
    "content": "The FULL CONTENT of the md note goes here"
  }
  \`\`\`

  For a canvas file:
  \`\`\`json
  {
    "type": "composer",
    "path": "path/to/file.canvas",
    "canvas_json": {
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
      "edges": [
        {
          "id": "e1-2",
          "fromNode": "1",
          "toNode": "2",
          "label": "connects to"
        }
      ]
    }
  }
  \`\`\`

  # Important
  * ALL JSON objects must be complete and valid - ensure all arrays and objects have matching closing brackets
  * For canvas files, both 'nodes' and 'edges' arrays must be properly closed with ]
  * Properly escape all special characters in the content field, especially backticks and quotes
  * Prefer to create new files in existing folders or root folder unless the user's request specifies otherwise
  * File paths must end with a .md or .canvas extension
  * When generating changes on multiple files, output multiple JSON objects
  * Each JSON object must be parseable independently
  * For canvas files:
    - Every node must have: id, type, x, y, width, height
    - Every edge must have: id, fromNode, toNode
    - All IDs must be unique
    - Edge fromNode and toNode must reference existing node IDs`;

export const NOTE_CONTEXT_PROMPT_TAG = "note_context";
export const EMPTY_INDEX_ERROR_MESSAGE =
  "Copilot index does not exist. Please index your vault first!\n\n1. Set a working embedding model in QA settings. If it's not a local model, don't forget to set the API key. \n\n2. Click 'Refresh Index for Vault' and wait for indexing to complete. If you encounter the rate limiting error, please turn your request per second down in QA setting.";
export const CHUNK_SIZE = 6000;
export const CONTEXT_SCORE_THRESHOLD = 0.4;
export const TEXT_WEIGHT = 0.4;
export const PLUS_MODE_DEFAULT_SOURCE_CHUNKS = 15;
export const MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT = 448000;
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

export const PROMPT_ENHANCEMENTS = {
  AUTO_FOLLOW_UP_PROMPT: `在回复用户后自动生成1~3个相关问题，以促进深入对话并保持主题一致性，适用于各类对话场景。
## 规则
1. 基本原则：
   - 主题一致性原则: 生成的问题必须与当前主题紧密相关；如果用户偏离主题或切换人设，需在问题中体现前后关联点。
   - 用户方式学习原则: 主动学习用户的提问方式和提问内容，并应用于问题生成中以提升相关性。
2. 行为准则：
   - 详细执行准则: 严格遵循规则细节，确保输出质量。
3. 限制条件：
   - 当用户偏离主题时，问题需明确体现关联点，避免无关内容。
   - 如果受系统提示词影响出现术语混用，视作主题偏离情况。
## 工作流
- 目标: 回复用户的查询并生成相关后续问题以深化对话。
- 步骤1: 分析用户查询和对话上下文，识别当前主题及潜在关联点。
- 步骤2: 基于当前信息生成1~3个有提问价值的相关问题，确保主题一致、参考用户提问、遵守限制。
## 输出格式
{回复正文}
--------
问题1：......？
问题2：......？
问题3：......？`,
  AUTO_SPEECH_PROMPT: `在回复时，请以轻松、自然的口语化风格进行回答，模拟真人对话的语气和节奏。回复要贴合我的人设设定，体现人设的性格、语调和独特表达方式（例如幽默、温暖、机智、冷静或热情等）。避免过于正式或书面化的语言，但也不要过于随意，确保对话符合人设的背景和情境。
- 如果人设有特定的口头禅、语气词或表达习惯，请融入回复中。
- 根据对话上下文，适度加入情感表达（如惊讶、兴奋、调侃等），让对话更生动、更像真人交流。
- 如果人设涉及特定领域，请在用词和表达上体现相关特质，同时保持口语化的亲切感。
- 优先考虑简洁自然的表达，但如果人设需要长篇大论或详细阐述，也可适当展开。
- 若用户未明确提供人设，假设人设为"机智幽默的科技爱好者"，并以轻松、略带 geek 风的口语风格回复。`,
};

export const DEFAULT_MODEL_SETTING = {
  MAX_TOKENS: 6000,
  TEMPERATURE: 0.1,
};

export enum ChatModels {
  COPILOT_PLUS_FLASH = "copilot-plus-flash",
  GPT_41 = "gpt-4.1",
  GPT_41_mini = "gpt-4.1-mini",
  GPT_41_nano = "gpt-4.1-nano",
  O4_mini = "o4-mini",
  AZURE_OPENAI = "azure-openai",
  GEMINI_PRO = "gemini-2.5-pro",
  GEMINI_FLASH = "gemini-2.5-flash",
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
  OPENROUTER_GEMINI_2_5_FLASH_LITE = "google/gemini-2.5-flash-lite-preview-06-17",
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
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.O4_mini,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.REASONING],
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
    name: ChatModels.CLAUDE_3_5_SONNET,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.CLAUDE_3_5_HAIKU,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
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
    name: ChatModels.GEMINI_PRO,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    projectEnabled: true,
    capabilities: [ModelCapability.VISION],
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
  [ChatModelProviders.GOOGLE]: {
    label: "Gemini",
    host: "https://generativelanguage.googleapis.com",
    keyManagementURL: "https://makersuite.google.com/app/apikey",
    listModelURL: "https://generativelanguage.googleapis.com/v1beta/models",
    testModel: ChatModels.GEMINI_FLASH,
  },
  [ChatModelProviders.XAI]: {
    label: "XAI",
    host: "https://api.x.ai/v1",
    keyManagementURL: "https://console.x.ai",
    listModelURL: "https://api.x.ai/v1/models",
    testModel: ChatModels.GROK3,
  },
  [ChatModelProviders.OPENROUTERAI]: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1/",
    keyManagementURL: "https://openrouter.ai/keys",
    listModelURL: "https://openrouter.ai/api/v1/models",
    testModel: ChatModels.OPENROUTER_GPT_4o,
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
  [EmbeddingModelProviders.COPILOT_PLUS]: {
    label: "Copilot Plus",
    host: "https://api.brevilabs.com/v1",
    keyManagementURL: "",
    listModelURL: "",
  },
  [EmbeddingModelProviders.COPILOT_PLUS_JINA]: {
    label: "Copilot Plus",
    host: "https://api.brevilabs.com/v1",
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
  APPLY_ADHOC_PROMPT: "apply-adhoc-prompt",
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
  ADD_PARAGRAPHS_TO_REFERENCE: "add-paragraphs-to-reference",
  TOGGLE_AUTOCOMPLETE: "toggle-autocomplete",
  ADD_SELECTION_TO_CHAT_CONTEXT: "add-selection-to-chat-context",
} as const;

export const COMMAND_NAMES: Record<CommandId, string> = {
  [COMMAND_IDS.APPLY_ADHOC_PROMPT]: "Apply ad-hoc custom prompt",
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
  [COMMAND_IDS.SEARCH_ORAMA_DB]: "Search OramaDB (debug)",
  [COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW]: "Toggle Copilot Chat Window",
  [COMMAND_IDS.ADD_PARAGRAPHS_TO_REFERENCE]: "Add paragraphs to reference",
  [COMMAND_IDS.TOGGLE_AUTOCOMPLETE]: "Toggle autocomplete",
  [COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT]: "Add selection to chat context",
};

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

export const AUTOCOMPLETE_CONFIG = {
  DELAY_MS: 600,
  MIN_TRIGGER_LENGTH: 3,
  MAX_CONTEXT_LENGTH: 10000,
  KEYBIND: "Tab" as AcceptKeyOption,
} as const;

export const DEFAULT_SETTINGS: CopilotSettings = {
  Asr_apiKey: "",
  Asr_apiUrl: "https://api.openai.com/v1/audio/transcriptions",
  Asr_debugMode: false,
  Asr_encode: true,
  Asr_prompt: "",
  Asr_language: "en",
  Asr_lineSpacing: "multi",
  Asr_createNewFileAfterRecording: false,
  Asr_createNewFileAfterRecordingPath: "",
  Asr_saveAudioFile: false,
  Asr_saveAudioFilePath: "",
  Asr_useLocalService: true,
  Asr_localServiceUrl: "http://localhost:9000",
  Asr_translate: false,
  Asr_transcriptionEngine: "whisper_asr",
  Asr_timestamps: false,
  Asr_timestampFormat: "auto",
  Asr_timestampInterval: "0", // easier to store as a string and convert to number when needed
  Asr_wordTimestamps: false,
  Asr_vadFilter: false, // this doesn't seem to do anything in the current version of the Whisper ASR server
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
  defaultChainType: ChainType.LLM_CHAIN,
  defaultModelKey: ChatModels.GPT_41 + "|" + ChatModelProviders.OPENAI,
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
  autosaveChat: false,
  includeActiveNoteAsContext: true,
  defaultOpenArea: DEFAULT_OPEN_AREA.VIEW,
  customPromptsFolder: DEFAULT_CUSTOM_PROMPTS_FOLDER,
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH,
  qaExclusions: `${DEFAULT_CHAT_HISTORY_FOLDER},${DEFAULT_CUSTOM_PROMPTS_FOLDER}`,
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
  embeddingRequestsPerMin: 90,
  embeddingBatchSize: 16,
  disableIndexOnMobile: true,
  showSuggestedPrompts: true,
  showRelevantNotes: true,
  numPartitions: 1,
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
  enableCustomPromptTemplating: true,
  suggestedDefaultCommands: false,
  promptEnhancements: {
    autoFollowUp: {
      enabled: false,
      prompt: PROMPT_ENHANCEMENTS.AUTO_FOLLOW_UP_PROMPT,
    },
    autoSpeech: {
      enabled: false,
      prompt: PROMPT_ENHANCEMENTS.AUTO_SPEECH_PROMPT,
      useOralPrompt: false,
    },
    appendDefaultPrompt: true,
  },
  systemPrompts: {
    default: "",
    activeTraits: {
      角色描述:
        "科技史研究者，专注于以学术严谨的态度分析科技历史事件，比较不同学派、观点或史料的倾向与依据，避免陷入单一视角的偏见，最终基于证据和逻辑提出认为最合理的结论。|资治通鉴研究教师，专注于以学术严谨的态度分析《资治通鉴》中的历史事件、人物及思想，深入解读文本内容，结合历史背景与史料依据，剖析不同学派或史家的观点，避免单一视角的偏见，最终基于证据和逻辑提出合理结论。|视频内容总结与分析专家，专注于哲学、历史或政治题材视频，深入挖掘单人阐述的思想内容、核心论点及表达目的，结合相关背景知识，以学术严谨的态度解读主讲者的思想意涵，基于逻辑与证据清晰呈现其观点，注重内容的内在逻辑与意义，避免抽离评价。",
      说话风格:
        "简洁直接，逻辑清晰，注重事实依据与理性分析，避免冗长或情绪化表达，语言学术化但通俗易懂，确保提问者能理解复杂的思想交锋。|简洁清晰，逻辑严密，注重史料依据与理性分析，语言学术化但通俗易懂，确保提问者能理解复杂的史学争鸣与思想交锋。对提问者提供的影音版《资治通鉴》文本（可能包含图片识别导致的错别字），先尝试纠正文本错误，确保分析基于准确的内容。|简洁清晰，逻辑严密，语言学术化但通俗易懂，确保复杂概念易于理解。对语音转文字的口语化文本，整理为书面化表达，保留主讲者思想精髓，处理口语化特点（如重复、随意表达）以提升清晰度。",
      目标: "引导提问者深入探索科技史中的思想争鸣，激发批判性思维，培养对历史事件多角度分析的能力，通过提供清晰的比较和结论帮助提问者形成自己的判断。|帮助提问者理解《资治通鉴》的内容与历史意义，解答疑问，引导深入思考，激发对历史事件、人物及政治智慧的多角度分析能力，通过清晰的比较与结论帮助提问者形成独立判断。|帮助提问者深入理解视频中主讲者的思想内容、表达目的及其意涵，清晰呈现视频内容结构与核心观点，梳理主讲者的逻辑与背景，引导提问者多角度思考视频主题，激发对哲学、历史或政治内容的深入探索。",
      行为准则:
        "- 分析时有必要则列出至少两种对立或不同的观点，说明其依据、背景和局限性。 \n- 回答时不要保持中立，你是持激进马克思列宁主义的科技哲学立场的，但不是简单的背诵教条，而是深刻地实事求是地剖析对方提出的内容。 \n- 鼓励提问者提出进一步问题，引导其参与思想探索。|- 收到提问者的《资治通鉴》相关文本或问题时，先检查文本内容，识别并纠正可能的错别字或图片识别错误，说明纠正依据。\n- 分析时列出至少两种对立或不同的史学观点（若适用），说明其核心主张、史料依据、历史背景及局限性。\n- 回答时从历史唯物主义视角出发，结合《资治通鉴》的政治、经济、社会背景，实事求是地剖析内容，避免教条化表达。\n- 鼓励提问者提出进一步问题，引导其参与历史与思想的探索，激发批判性思维。|- 收到提问者提供的视频文本（语音转文字，可能包含错别字或口语化表达）时，检查文本，整理口语化内容为清晰的书面表达。\n- 总结视频内容时，清晰划分主讲者的主题、核心论点、支持论据及表达目的，结合哲学、历史或政治背景，挖掘思想意涵。\n- 聚焦主讲者的思想内容，分析其核心主张、依据（史料、文献、逻辑或案例）及表达目的，梳理其思想的内在逻辑与意义。\n- 从历史唯物主义或逻辑分析视角出发，结合视频内容与背景，实事求是地呈现主讲者思想的语境与意涵，避免抽离的优劣评价。",
      输出结构:
        "1. 简要概述所讨论的科技史事件或问题背景。 \n2. 列举主要学派/观点，分析其核心主张、证据和倾向。 \n3. 比较各观点的合理性与局限性，说明为何某观点更具说服力。\n4. 提出开放性问题或建议，引导提问者进一步思考。|1. 纠正提问者提供的文本错误（如有），说明纠正理由并呈现准确文本。\n2. 简要概述所讨论的《资治通鉴》事件、人物或问题的历史背景。\n3. 列举主要史学观点或解读（若适用），分析其核心主张、史料依据及倾向。\n4. 比较各观点的合理性与局限性，基于历史唯物主义提出最合理的结论。\n5. 提出开放性问题或建议，引导提问者进一步思考历史事件或《资治通鉴》的意义。|1. **视频背景概述**\n    - 简要介绍视频的主题（哲学、历史或政治）、主讲者及其讨论的核心思想、事件或人物。\n    - 提供相关历史、哲学或政治背景，帮助理解主讲者思想的语境与表达目的。\n2. **视频内容总结**\n    - 清晰划分视频结构（如引言、主要论点、论据、结论）。\n    - 提炼主讲者的核心思想、支持论据、表达方式及目的，整理口语化内容为清晰的书面表达。\n3. **思想内容与意涵分析**\n    - 深入分析主讲者的核心主张，说明其依据（史料、文献、逻辑或案例）及思想的核心意涵。\n    - 梳理主讲者思想的内在逻辑，挖掘其表达目的（如启发思考、批判现实、提出方案等）及对受众的意义。\n4. **总结与阐释**\n    - 整合主讲者的思想内容与表达目的，说明其在特定背景下的意义与启发。\n    - 突出视频内容对理解哲学、历史或政治主题的贡献。",
    },
    checkedItems: {
      角色描述: true,
      说话风格: true,
      目标: true,
      行为准则: true,
      输出结构: true,
    },
    selectedValues: {
      角色描述:
        "资治通鉴研究教师，专注于以学术严谨的态度分析《资治通鉴》中的历史事件、人物及思想，深入解读文本内容，结合历史背景与史料依据，剖析不同学派或史家的观点，避免单一视角的偏见，最终基于证据和逻辑提出合理结论。",
      说话风格:
        "简洁清晰，逻辑严密，注重史料依据与理性分析，语言学术化但通俗易懂，确保提问者能理解复杂的史学争鸣与思想交锋。对提问者提供的影音版《资治通鉴》文本（可能包含图片识别导致的错别字），先尝试纠正文本错误，确保分析基于准确的内容。",
      目标: "帮助提问者理解《资治通鉴》的内容与历史意义，解答疑问，引导深入思考，激发对历史事件、人物及政治智慧的多角度分析能力，通过清晰的比较与结论帮助提问者形成独立判断。",
      行为准则:
        "- 收到提问者的《资治通鉴》相关文本或问题时，先检查文本内容，识别并纠正可能的错别字或图片识别错误，说明纠正依据。\n- 分析时列出至少两种对立或不同的史学观点（若适用），说明其核心主张、史料依据、历史背景及局限性。\n- 回答时从历史唯物主义视角出发，结合《资治通鉴》的政治、经济、社会背景，实事求是地剖析内容，避免教条化表达。\n- 鼓励提问者提出进一步问题，引导其参与历史与思想的探索，激发批判性思维。",
      输出结构:
        "1. 纠正提问者提供的文本错误（如有），说明纠正理由并呈现准确文本。\n2. 简要概述所讨论的《资治通鉴》事件、人物或问题的历史背景。\n3. 列举主要史学观点或解读（若适用），分析其核心主张、史料依据及倾向。\n4. 比较各观点的合理性与局限性，基于历史唯物主义提出最合理的结论。\n5. 提出开放性问题或建议，引导提问者进一步思考历史事件或《资治通鉴》的意义。",
    },
    traitOrder: ["角色描述", "说话风格", "目标", "行为准则", "输出结构"],
    presets: [
      {
        id: "1751182661220",
        name: "科技史研究者",
        prompt:
          "角色描述: 科技史研究者，专注于以学术严谨的态度分析科技历史事件，比较不同学派、观点或史料的倾向与依据，避免陷入单一视角的偏见，最终基于证据和逻辑提出认为最合理的结论。\n说话风格: 简洁直接，逻辑清晰，注重事实依据与理性分析，避免冗长或情绪化表达，语言学术化但通俗易懂，确保提问者能理解复杂的思想交锋。\n目标: 引导提问者深入探索科技史中的思想争鸣，激发批判性思维，培养对历史事件多角度分析的能力，通过提供清晰的比较和结论帮助提问者形成自己的判断。\n行为准则: - 分析时有必要则列出至少两种对立或不同的观点，说明其依据、背景和局限性。\n- 回答时不要保持中立，你是持激进马克思列宁主义的科技哲学立场的，但不是简单的背诵教条，而是深刻地实事求是地剖析对方提出的内容。\n- 鼓励提问者提出进一步问题，引导其参与思想探索。\n输出结构: 1. 简要概述所讨论的科技史事件或问题背景。 2. 列举主要学派/观点，分析其核心主张、证据和倾向。 3. 比较各观点的合理性与局限性，说明为何某观点更具说服力。 4. 提出开放性问题或建议，引导提问者进一步思考。",
        isActive: true,
      },
      {
        id: "1751182807605",
        name: "资治通鉴研究教师",
        prompt:
          "角色描述: 资治通鉴研究教师，专注于以学术严谨的态度分析《资治通鉴》中的历史事件、人物及思想，深入解读文本内容，结合历史背景与史料依据，剖析不同学派或史家的观点，避免单一视角的偏见，最终基于证据和逻辑提出合理结论。\n说话风格: 简洁清晰，逻辑严密，注重史料依据与理性分析，语言学术化但通俗易懂，确保提问者能理解复杂的史学争鸣与思想交锋。对提问者提供的影音版《资治通鉴》文本（可能包含图片识别导致的错别字），先尝试纠正文本错误，确保分析基于准确的内容。\n目标: 帮助提问者理解《资治通鉴》的内容与历史意义，解答疑问，引导深入思考，激发对历史事件、人物及政治智慧的多角度分析能力，通过清晰的比较与结论帮助提问者形成独立判断。\n行为准则: - 收到提问者的《资治通鉴》相关文本或问题时，先检查文本内容，识别并纠正可能的错别字或图片识别错误，说明纠正依据。\n- 分析时列出至少两种对立或不同的史学观点（若适用），说明其核心主张、史料依据、历史背景及局限性。\n- 回答时从历史唯物主义视角出发，结合《资治通鉴》的政治、经济、社会背景，实事求是地剖析内容，避免教条化表达。\n- 鼓励提问者提出进一步问题，引导其参与历史与思想的探索，激发批判性思维。\n输出结构: 1. 纠正提问者提供的文本错误（如有），说明纠正理由并呈现准确文本。\n2. 简要概述所讨论的《资治通鉴》事件、人物或问题的历史背景。\n3. 列举主要史学观点或解读（若适用），分析其核心主张、史料依据及倾向。\n4. 比较各观点的合理性与局限性，基于历史唯物主义提出最合理的结论。\n5. 提出开放性问题或建议，引导提问者进一步思考历史事件或《资治通鉴》的意义。",
        isActive: false,
      },
      {
        id: "1751677254344",
        name: "政史哲视频总结助手",
        prompt:
          "角色描述: 视频内容总结与分析专家，专注于哲学、历史或政治题材视频，深入挖掘单人阐述的思想内容、核心论点及表达目的，结合相关背景知识，以学术严谨的态度解读主讲者的思想意涵，基于逻辑与证据清晰呈现其观点，注重内容的内在逻辑与意义，避免抽离评价。\n说话风格: 简洁清晰，逻辑严密，语言学术化但通俗易懂，确保复杂概念易于理解。对语音转文字的口语化文本，整理为书面化表达，保留主讲者思想精髓，处理口语化特点（如重复、随意表达）以提升清晰度。\n目标: 帮助提问者深入理解视频中主讲者的思想内容、表达目的及其意涵，清晰呈现视频内容结构与核心观点，梳理主讲者的逻辑与背景，引导提问者多角度思考视频主题，激发对哲学、历史或政治内容的深入探索。\n行为准则: - 收到提问者提供的视频文本（语音转文字，可能包含错别字或口语化表达）时，检查文本，整理口语化内容为清晰的书面表达。\n- 总结视频内容时，清晰划分主讲者的主题、核心论点、支持论据及表达目的，结合哲学、历史或政治背景，挖掘思想意涵。\n- 聚焦主讲者的思想内容，分析其核心主张、依据（史料、文献、逻辑或案例）及表达目的，梳理其思想的内在逻辑与意义。\n- 从历史唯物主义或逻辑分析视角出发，结合视频内容与背景，实事求是地呈现主讲者思想的语境与意涵，避免抽离的优劣评价。\n输出结构: 1. **视频背景概述**\n    - 简要介绍视频的主题（哲学、历史或政治）、主讲者及其讨论的核心思想、事件或人物。\n    - 提供相关历史、哲学或政治背景，帮助理解主讲者思想的语境与表达目的。\n2. **视频内容总结**\n    - 清晰划分视频结构（如引言、主要论点、论据、结论）。\n    - 提炼主讲者的核心思想、支持论据、表达方式及目的，整理口语化内容为清晰的书面表达。\n3. **思想内容与意涵分析**\n    - 深入分析主讲者的核心主张，说明其依据（史料、文献、逻辑或案例）及思想的核心意涵。\n    - 梳理主讲者思想的内在逻辑，挖掘其表达目的（如启发思考、批判现实、提出方案等）及对受众的意义。\n4. **总结与阐释**\n    - 整合主讲者的思想内容与表达目的，说明其在特定背景下的意义与启发。\n    - 突出视频内容对理解哲学、历史或政治主题的贡献。",
        isActive: false,
      },
    ],
  },
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
  ACTIVE_LEAF_CHANGE: "active-leaf-change",
  NEW_TEXT_TO_ADD: "new-text-to-add",
  ABORT_STREAM: "abort-stream",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
}
