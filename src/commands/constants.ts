import { CustomCommand } from "@/commands/type";

export const LEGACY_SELECTED_TEXT_PLACEHOLDER = "{copilot-selection}";
export const COMMAND_NAME_MAX_LENGTH = 50;
export const EMPTY_COMMAND: CustomCommand = {
  title: "",
  content: "",
  showInContextMenu: false,
  showInSlashMenu: false,
  order: Number.MAX_SAFE_INTEGER,
  modelKey: "",
  lastUsedMs: 0,
};

// Custom command frontmatter property constants
export const COPILOT_COMMAND_CONTEXT_MENU_ENABLED = "copilot-command-context-menu-enabled";
export const COPILOT_COMMAND_SLASH_ENABLED = "copilot-command-slash-enabled";
export const COPILOT_COMMAND_CONTEXT_MENU_ORDER = "copilot-command-context-menu-order";
export const COPILOT_COMMAND_MODEL_KEY = "copilot-command-model-key";
export const COPILOT_COMMAND_LAST_USED = "copilot-command-last-used";
export const DEFAULT_COMMANDS: CustomCommand[] = [
  {
    title: "Fix grammar and spelling",
    content: `Fix the grammar and spelling of {}. Preserve all formatting, line breaks, and special characters. Do not add or remove any content. Return only the corrected text.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1000,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Translate to Chinese",
    content: `Translate {} into Chinese:
    1. Preserve the meaning and tone
    2. Maintain appropriate cultural context
    3. Keep formatting and structure
    Return only the translated text.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1010,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Summarize",
    content: `Create a bullet-point summary of {}. Each bullet point should capture a key point. Return only the bullet-point summary.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1020,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Simplify",
    content: `Simplify {} to a 6th-grade reading level (ages 11-12). Use simple sentences, common words, and clear explanations. Maintain the original key concepts. Return only the simplified text.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1030,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Explain like I am 5",
    content: `Explain {} in simple terms that a 5-year-old would understand:
    1. Use basic vocabulary
    2. Include simple analogies
    3. Break down complex concepts
    Return only the simplified explanation.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1040,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Emojify",
    content: `Add relevant emojis to enhance {}. Follow these rules:
    1. Insert emojis at natural breaks in the text
    2. Never place two emojis next to each other
    3. Keep all original text unchanged
    4. Choose emojis that match the context and tone
    Return only the emojified text.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1050,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Make shorter",
    content: `Reduce {} to half its length while preserving these elements:
    1. Main ideas and key points
    2. Essential details
    3. Original tone and style
    Return only the shortened text.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1060,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Make longer",
    content: `Expand {} to twice its length by:
    1. Adding relevant details and examples
    2. Elaborating on key points
    3. Maintaining the original tone and style
    Return only the expanded text.`,
    showInContextMenu: true,
    showInSlashMenu: true,
    order: 1070,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Generate table of contents",
    content: `Generate a hierarchical table of contents for {}. Use appropriate heading levels (H1, H2, H3, etc.). Include page numbers if present. Return only the table of contents.`,
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 1080,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Generate glossary",
    content: `Create a glossary of important terms, concepts, and phrases from {}. Format each entry as "Term: Definition". Sort entries alphabetically. Return only the glossary.`,
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 1090,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Remove URLs",
    content: `Remove all URLs from {}. Preserve all other content and formatting. URLs may be in various formats (http, https, www). Return only the text with URLs removed.`,
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 1100,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Rewrite as tweet",
    content: `Rewrite {} as a single tweet with these requirements:
    1. Maximum 280 characters
    2. Use concise, impactful language
    3. Maintain the core message
    Return only the tweet text.`,
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 1110,
    modelKey: "",
    lastUsedMs: 0,
  },
  {
    title: "Rewrite as tweet thread",
    content: `Convert {} into a Twitter thread following these rules:
    1. Each tweet must be under 240 characters
    2. Start with "THREAD START" on its own line
    3. Separate tweets with "\n\n---\n\n"
    4. End with "THREAD END" on its own line
    5. Make content engaging and clear
    Return only the formatted thread.`,
    showInContextMenu: false,
    showInSlashMenu: false,
    order: 1120,
    modelKey: "",
    lastUsedMs: 0,
  },
];
