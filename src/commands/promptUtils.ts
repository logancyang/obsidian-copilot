import { COMMAND_IDS } from "@/constants";

import { PROCESS_SELECTION_COMMANDS } from "@/constants";

function fixGrammarSpellingSelectionPrompt(selectedText: string): string {
  return (
    `Please fix the grammar and spelling of the following text and return it without any other changes:\n\n` +
    `${selectedText}`
  );
}

function summarizePrompt(selectedText: string): string {
  return (
    `Summarize the following text into bullet points and return it without any other changes. Identify the input language, and return the summary in the same language. If the input is English, return the summary in English. Otherwise, return in the same language as the input. Return ONLY the summary, DO NOT return the name of the language:\n\n` +
    `${selectedText}`
  );
}

function tocPrompt(selectedText: string): string {
  return (
    `Please generate a table of contents for the following text and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

function glossaryPrompt(selectedText: string): string {
  return (
    `Please generate a glossary for the following text and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

function simplifyPrompt(selectedText: string): string {
  return (
    `Please simplify the following text so that a 6th-grader can understand. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

function emojifyPrompt(selectedText: string): string {
  return (
    `Please insert emojis to the following content without changing the text.` +
    `Insert at as many places as possible, but don't have any 2 emojis together. The original text must be returned.\n` +
    `Content: ${selectedText}`
  );
}

function removeUrlsFromSelectionPrompt(selectedText: string): string {
  return (
    `Please remove all URLs from the following text and return it without any other changes:\n\n` +
    `${selectedText}`
  );
}

function rewriteTweetSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following content to under 280 characters using simple sentences. Output in the same language as the source, do not output English if it is not English. Please follow the instruction strictly. Content:\n
    + ${selectedText}`;
}

function rewriteTweetThreadSelectionPrompt(selectedText: string): string {
  return (
    `Please follow the instructions closely step by step and rewrite the content to a thread. ` +
    `1. Each paragraph must be under 240 characters. ` +
    `2. The starting line is \`THREAD START\n\`, and the ending line is \`\nTHREAD END\`. ` +
    `3. You must use \`\n\n---\n\n\` to separate each paragraph! Then return it without any other changes. ` +
    `4. Make it as engaging as possible.` +
    `5. Output in the same language as the source, do not output English if it is not English.\n The original content:\n\n` +
    `${selectedText}`
  );
}

function rewriteShorterSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it half as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n` +
    `${selectedText}`
  );
}

function rewriteLongerSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it twice as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n` +
    `${selectedText}`
  );
}

function eli5SelectionPrompt(selectedText: string): string {
  return (
    `Please explain the following text like I'm 5 years old. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

function rewritePressReleaseSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it sound like a press release. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

function translateSelectionPrompt(selectedText: string, language?: string) {
  return `Please translate the following text to ${language}:\n\n` + `${selectedText}`;
}

function changeToneSelectionPrompt(selectedText: string, tone?: string) {
  return (
    `Please change the tone of the following text to ${tone}. Identify the language first, then Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
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
