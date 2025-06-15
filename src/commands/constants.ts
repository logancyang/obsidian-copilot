import { CustomCommand } from "@/commands/type";
import { InlineEditCommandSettings } from "@/settings/model";

export const SELECTED_TEXT_PLACEHOLDER = "{copilot-selection}";
export const COMMAND_NAME_MAX_LENGTH = 50;
export const EMPTY_COMMAND: CustomCommand = {
  title: "",
  content: "",
  showInContextMenu: false,
  showInSlashMenu: false,
  order: Number.MAX_SAFE_INTEGER,
  modelKey: "",
};

// Custom command frontmatter property constants
export const COPILOT_COMMAND_CONTEXT_MENU_ENABLED = "copilot-command-context-menu-enabled";
export const COPILOT_COMMAND_SLASH_ENABLED = "copilot-command-slash-enabled";
export const COPILOT_COMMAND_CONTEXT_MENU_ORDER = "copilot-command-context-menu-order";
export const COPILOT_COMMAND_MODEL_KEY = "copilot-command-model-key";
export const COPILOT_COMMAND_LAST_USED = "copilot-command-last-used";
export const DEFAULT_INLINE_EDIT_COMMANDS: InlineEditCommandSettings[] = [
  {
    name: "Fix grammar and spelling",
    prompt: `Fix the grammar and spelling of {}. Preserve all formatting, line breaks, and special characters. Do not add or remove any content. Return only the corrected text.`,
    showInContextMenu: true,
  },
  {
    name: "Translate to Chinese",
    prompt: `Translate {} into Chinese:
    1. Preserve the meaning and tone
    2. Maintain appropriate cultural context
    3. Keep formatting and structure
    Return only the translated text.`,
    showInContextMenu: true,
  },
  {
    name: "Summarize",
    prompt: `Create a bullet-point summary of {}. Each bullet point should capture a key point. Return only the bullet-point summary.`,
    showInContextMenu: true,
  },
  {
    name: "Simplify",
    prompt: `Simplify {} to a 6th-grade reading level (ages 11-12). Use simple sentences, common words, and clear explanations. Maintain the original key concepts. Return only the simplified text.`,
    showInContextMenu: true,
  },
  {
    name: "Emojify",
    prompt: `Add relevant emojis to enhance {}. Follow these rules:
    1. Insert emojis at natural breaks in the text
    2. Never place two emojis next to each other
    3. Keep all original text unchanged
    4. Choose emojis that match the context and tone
    Return only the emojified text.`,
    showInContextMenu: true,
  },
  {
    name: "Make shorter",
    prompt: `Reduce {} to half its length while preserving these elements:
    1. Main ideas and key points
    2. Essential details
    3. Original tone and style
    Return only the shortened text.`,
    showInContextMenu: true,
  },
  {
    name: "Make longer",
    prompt: `Expand {} to twice its length by:
    1. Adding relevant details and examples
    2. Elaborating on key points
    3. Maintaining the original tone and style
    Return only the expanded text.`,
    showInContextMenu: true,
  },
  {
    name: "Generate table of contents",
    prompt: `Generate a hierarchical table of contents for {}. Use appropriate heading levels (H1, H2, H3, etc.). Include page numbers if present. Return only the table of contents.`,
    showInContextMenu: false,
  },
  {
    name: "Generate glossary",
    prompt: `Create a glossary of important terms, concepts, and phrases from {}. Format each entry as "Term: Definition". Sort entries alphabetically. Return only the glossary.`,
    showInContextMenu: false,
  },
  {
    name: "Remove URLs",
    prompt: `Remove all URLs from {}. Preserve all other content and formatting. URLs may be in various formats (http, https, www). Return only the text with URLs removed.`,
    showInContextMenu: false,
  },
  {
    name: "Rewrite as tweet",
    prompt: `Rewrite {} as a single tweet with these requirements:
    1. Maximum 280 characters
    2. Use concise, impactful language
    3. Maintain the core message
    Return only the tweet text.`,
    showInContextMenu: false,
  },
  {
    name: "Rewrite as tweet thread",
    prompt: `Convert {} into a Twitter thread following these rules:
    1. Each tweet must be under 240 characters
    2. Start with "THREAD START" on its own line
    3. Separate tweets with "\n\n---\n\n"
    4. End with "THREAD END" on its own line
    5. Make content engaging and clear
    Return only the formatted thread.`,
    showInContextMenu: false,
  },
  {
    name: "Explain like I am 5",
    prompt: `Explain {} in simple terms that a 5-year-old would understand:
    1. Use basic vocabulary
    2. Include simple analogies
    3. Break down complex concepts
    Return only the simplified explanation.`,
    showInContextMenu: false,
  },
  {
    name: "Rewrite as press release",
    prompt: `Transform {} into a professional press release:
    1. Use formal, journalistic style
    2. Include headline and dateline
    3. Follow inverted pyramid structure
    Return only the press release format.`,
    showInContextMenu: false,
  },
];
