import { InlineEditCommandSettings } from "@/settings/model";

export const SELECTED_TEXT_PLACEHOLDER = "{copilot-selection}";

export const DEFAULT_INLINE_EDIT_COMMANDS: InlineEditCommandSettings[] = [
  {
    name: "Fix grammar and spelling",
    prompt:
      `<instruction>Fix the grammar and spelling of the text below. Preserve all formatting, line breaks, and special characters. Do not add or remove any content. Return only the corrected text.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: true,
  },
  {
    name: "Summarize",
    prompt:
      `<instruction>Create a bullet-point summary of the text below. Each bullet point should capture a key point. Return only the bullet-point summary.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: true,
  },
  {
    name: "Generate table of contents",
    prompt:
      `<instruction>Generate a hierarchical table of contents for the text below. Use appropriate heading levels (H1, H2, H3, etc.). Include page numbers if present. Return only the table of contents.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: false,
  },
  {
    name: "Generate glossary",
    prompt:
      `<instruction>Create a glossary of important terms, concepts, and phrases from the text below. Format each entry as "Term: Definition". Sort entries alphabetically. Return only the glossary.</instruction>\n\n` +
      `<text>{copilot-selection}</text>`,
    showInContextMenu: false,
  },
  {
    name: "Simplify",
    prompt:
      `<instruction>Simplify the text below to a 6th-grade reading level (ages 11-12). Use simple sentences, common words, and clear explanations. Maintain the original key concepts. Return only the simplified text.</instruction>\n\n` +
      `<text>{copilot-selection}</text>`,
    showInContextMenu: true,
  },
  {
    name: "Emojify",
    prompt:
      `<instruction>Add relevant emojis to enhance the text below. Follow these rules:
    1. Insert emojis at natural breaks in the text
    2. Never place two emojis next to each other
    3. Keep all original text unchanged
    4. Choose emojis that match the context and tone
    Return only the emojified text.</instruction>\n\n` + `<text>{copilot-selection}</text>`,
    showInContextMenu: true,
  },
  {
    name: "Remove URLs",
    prompt:
      `<instruction>Remove all URLs from the text below. Preserve all other content and formatting. URLs may be in various formats (http, https, www). Return only the text with URLs removed.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: false,
  },
  {
    name: "Rewrite as tweet",
    prompt:
      `<instruction>Rewrite the text below as a single tweet with these requirements:
    1. Maximum 280 characters
    2. Use concise, impactful language
    3. Maintain the core message
    Return only the tweet text.</instruction>\n\n` + `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: false,
  },
  {
    name: "Rewrite as tweet thread",
    prompt:
      `<instruction>Convert the text below into a Twitter thread following these rules:
    1. Each tweet must be under 240 characters
    2. Start with "THREAD START" on its own line
    3. Separate tweets with "\n\n---\n\n"
    4. End with "THREAD END" on its own line
    5. Make content engaging and clear
    Return only the formatted thread.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: false,
  },
  {
    name: "Make shorter",
    prompt:
      `<instruction>Reduce the text below to half its length while preserving these elements:
    1. Main ideas and key points
    2. Essential details
    3. Original tone and style
    Return only the shortened text.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: true,
  },
  {
    name: "Make longer",
    prompt:
      `<instruction>Expand the text below to twice its length by:
    1. Adding relevant details and examples
    2. Elaborating on key points
    3. Maintaining the original tone and style
    Return only the expanded text.</instruction>\n\n` + `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: true,
  },
  {
    name: "Explain like I am 5",
    prompt:
      `<instruction>Explain the text below in simple terms that a 5-year-old would understand:
    1. Use basic vocabulary
    2. Include simple analogies
    3. Break down complex concepts
    Return only the simplified explanation.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: false,
  },
  {
    name: "Rewrite as press release",
    prompt:
      `<instruction>Transform the text below into a professional press release:
    1. Use formal, journalistic style
    2. Include headline and dateline
    3. Follow inverted pyramid structure
    Return only the press release format.</instruction>\n\n` +
      `<text>${SELECTED_TEXT_PLACEHOLDER}</text>`,
    showInContextMenu: false,
  },
];
