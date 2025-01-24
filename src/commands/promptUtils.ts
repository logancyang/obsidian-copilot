import { COMMAND_IDS } from "@/constants";

import { PROCESS_SELECTION_COMMANDS } from "@/constants";

function fixGrammarSpellingSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Fix the grammar and spelling of the text below. Preserve all formatting, line breaks, and special characters. Do not add or remove any content. Return only the corrected text.</instruction>\n\n` +
    `<text>${selectedText}</text>`
  );
}

function summarizePrompt(selectedText: string): string {
  return (
    `<instruction>Create a bullet-point summary of the text below. Identify the input language and respond in the same language. Each bullet point should capture a key point. Return only the bullet-point summary.</instruction>\n\n` +
    `<text>${selectedText}</text>`
  );
}

function tocPrompt(selectedText: string): string {
  return (
    `<instruction>Generate a hierarchical table of contents for the text below. Use appropriate heading levels (H1, H2, H3, etc.). Include page numbers if present. Maintain the original language. Return only the table of contents.</instruction>\n\n` +
    `<text>${selectedText}</text>`
  );
}

function glossaryPrompt(selectedText: string): string {
  return (
    `<instruction>Create a glossary of important terms, concepts, and phrases from the text below. Format each entry as "Term: Definition". Sort entries alphabetically. Maintain the original language. Return only the glossary.</instruction>\n\n` +
    `<text>${selectedText}</text>`
  );
}

function simplifyPrompt(selectedText: string): string {
  return (
    `<instruction>Simplify the text below to a 6th-grade reading level (ages 11-12). Use simple sentences, common words, and clear explanations. Maintain the original language and key concepts. Return only the simplified text.</instruction>\n\n` +
    `<text>${selectedText}</text>`
  );
}

function emojifyPrompt(selectedText: string): string {
  return (
    `<instruction>Add relevant emojis to enhance the text below. Follow these rules:
    1. Insert emojis at natural breaks in the text
    2. Never place two emojis next to each other
    3. Keep all original text unchanged
    4. Choose emojis that match the context and tone
    Return only the emojified text.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function removeUrlsFromSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Remove all URLs from the text below. Preserve all other content and formatting. URLs may be in various formats (http, https, www). Return only the text with URLs removed.</instruction>\n\n` +
    `<text>${selectedText}</text>`
  );
}

function rewriteTweetSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Rewrite the text below as a single tweet with these requirements:
    1. Maximum 280 characters
    2. Use concise, impactful language
    3. Maintain the core message
    4. Keep the original language
    Return only the tweet text.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function rewriteTweetThreadSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Convert the text below into a Twitter thread following these rules:
    1. Each tweet must be under 240 characters
    2. Start with "THREAD START" on its own line
    3. Separate tweets with "\n\n---\n\n"
    4. End with "THREAD END" on its own line
    5. Make content engaging and clear
    6. Maintain the original language
    Return only the formatted thread.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function rewriteShorterSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Reduce the text below to half its length while preserving these elements:
    1. Main ideas and key points
    2. Essential details
    3. Original tone and style
    4. Original language
    Return only the shortened text.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function rewriteLongerSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Expand the text below to twice its length by:
    1. Adding relevant details and examples
    2. Elaborating on key points
    3. Maintaining the original tone and style
    4. Keeping the original language
    Return only the expanded text.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function eli5SelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Explain the text below in simple terms that a 5-year-old would understand:
    1. Use basic vocabulary
    2. Include simple analogies
    3. Break down complex concepts
    4. Keep the original language
    Return only the simplified explanation.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function rewritePressReleaseSelectionPrompt(selectedText: string): string {
  return (
    `<instruction>Transform the text below into a professional press release:
    1. Use formal, journalistic style
    2. Include headline and dateline
    3. Follow inverted pyramid structure
    4. Maintain the original language
    Return only the press release format.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function translateSelectionPrompt(selectedText: string, language?: string) {
  return (
    `<instruction>Translate the text below into ${language}:
    1. Preserve the meaning and tone
    2. Maintain appropriate cultural context
    3. Keep formatting and structure
    Return only the translated text.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

function changeToneSelectionPrompt(selectedText: string, tone?: string) {
  return (
    `<instruction>Rewrite the text below in a ${tone} tone while:
    1. Keeping the original meaning
    2. Maintaining the original language
    3. Adjusting word choice and phrasing
    4. Preserving key information
    Return only the rewritten text.</instruction>\n\n` + `<text>${selectedText}</text>`
  );
}

export const COMMAND_PROMPT_MAP: Record<
  (typeof PROCESS_SELECTION_COMMANDS)[number],
  (selectedText: string, eventSubtype?: string) => string
> = {
  [COMMAND_IDS.FIX_GRAMMAR]: fixGrammarSpellingSelectionPrompt,
  [COMMAND_IDS.SUMMARIZE]: summarizePrompt,
  [COMMAND_IDS.GENERATE_TOC]: tocPrompt,
  [COMMAND_IDS.GENERATE_GLOSSARY]: glossaryPrompt,
  [COMMAND_IDS.SIMPLIFY]: simplifyPrompt,
  [COMMAND_IDS.EMOJIFY]: emojifyPrompt,
  [COMMAND_IDS.REMOVE_URLS]: removeUrlsFromSelectionPrompt,
  [COMMAND_IDS.REWRITE_TWEET]: rewriteTweetSelectionPrompt,
  [COMMAND_IDS.REWRITE_TWEET_THREAD]: rewriteTweetThreadSelectionPrompt,
  [COMMAND_IDS.MAKE_SHORTER]: rewriteShorterSelectionPrompt,
  [COMMAND_IDS.MAKE_LONGER]: rewriteLongerSelectionPrompt,
  [COMMAND_IDS.ELI5]: eli5SelectionPrompt,
  [COMMAND_IDS.PRESS_RELEASE]: rewritePressReleaseSelectionPrompt,
  [COMMAND_IDS.TRANSLATE]: translateSelectionPrompt,
  [COMMAND_IDS.CHANGE_TONE]: changeToneSelectionPrompt,
};
