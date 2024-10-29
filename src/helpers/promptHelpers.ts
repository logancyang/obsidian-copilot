// helper contains business-related tools；
// generally, util contains business-independent tools

import { getNoteTitleAndTags } from "@/helpers/noteHelper";

// Basic prompts
export function sendNotesContentPrompt(notes: { name: string; content: string }[]): string {
  const formattedNotes = notes.map((note) => `## ${note.name}\n\n${note.content}`).join("\n\n");

  return (
    `Please read the notes below and be ready to answer questions about them. ` +
    `If there's no information about a certain topic, just say the note ` +
    `does not mention it. ` +
    `The content of the notes is between "/***/":\n\n/***/\n\n${formattedNotes}\n\n/***/\n\n` +
    `Please reply with the following word for word:` +
    `"OK I've read these notes. ` +
    `Feel free to ask related questions, such as 'give me a summary of these notes in bullet points', 'what key questions do these notes answer', etc. "\n`
  );
}

export function getChatContextStr(
  chatNoteContextPath: string,
  chatNoteContextTags: string[]
): string {
  const pathStr = chatNoteContextPath ? `\nChat context by path: ${chatNoteContextPath}` : "";
  const tagsStr =
    chatNoteContextTags?.length > 0 ? `\nChat context by tags: ${chatNoteContextTags}` : "";
  return pathStr + tagsStr;
}

export function getSendChatContextNotesPrompt(
  notes: { name: string; content: string }[],
  chatNoteContextPath: string,
  chatNoteContextTags: string[]
): string {
  const noteTitles = notes.map((note) => getNoteTitleAndTags(note)).join("\n\n");
  return (
    `Please read the notes below and be ready to answer questions about them. ` +
    getChatContextStr(chatNoteContextPath, chatNoteContextTags) +
    `\n\n${noteTitles}`
  );
}

export function fixGrammarSpellingSelectionPrompt(selectedText: string): string {
  return (
    `Please fix the grammar and spelling of the following text and return it without any other changes:\n\n` +
    `${selectedText}`
  );
}

export function summarizePrompt(selectedText: string): string {
  return (
    `Summarize the following text into bullet points and return it without any other changes. Identify the input language, and return the summary in the same language. If the input is English, return the summary in English. Otherwise, return in the same language as the input. Return ONLY the summary, DO NOT return the name of the language:\n\n` +
    `${selectedText}`
  );
}

export function tocPrompt(selectedText: string): string {
  return (
    `Please generate a table of contents for the following text and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function glossaryPrompt(selectedText: string): string {
  return (
    `Please generate a glossary for the following text and return it without any other changes. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function simplifyPrompt(selectedText: string): string {
  return (
    `Please simplify the following text so that a 6th-grader can understand. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function emojifyPrompt(selectedText: string): string {
  return (
    `Please insert emojis to the following content without changing the text.` +
    `Insert at as many places as possible, but don't have any 2 emojis together. The original text must be returned.\n` +
    `Content: ${selectedText}`
  );
}

export function removeUrlsFromSelectionPrompt(selectedText: string): string {
  return (
    `Please remove all URLs from the following text and return it without any other changes:\n\n` +
    `${selectedText}`
  );
}

export function rewriteLongerSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it twice as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n` +
    `${selectedText}`
  );
}

export function rewriteTweetSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following content to under 280 characters using simple sentences. Output in the same language as the source, do not output English if it is not English. Please follow the instruction strictly. Content:\n
    + ${selectedText}`;
}

export function rewriteTweetThreadSelectionPrompt(selectedText: string): string {
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

export function rewriteShorterSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it half as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n` +
    `${selectedText}`
  );
}

export function eli5SelectionPrompt(selectedText: string): string {
  return (
    `Please explain the following text like I'm 5 years old. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function rewritePressReleaseSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it sound like a press release. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function createTranslateSelectionPrompt(language?: string) {
  return (selectedText: string): string => {
    return `Please translate the following text to ${language}:\n\n` + `${selectedText}`;
  };
}

export function createChangeToneSelectionPrompt(tone?: string) {
  return (selectedText: string): string => {
    return (
      `Please change the tone of the following text to ${tone}. Identify the language first, then Output in the same language as the source, do not output English if it is not English:\n\n` +
      `${selectedText}`
    );
  };
}

export function extractNoteTitles(query: string): string[] {
  // Use a regular expression to extract note titles wrapped in [[]]
  const regex = /\[\[(.*?)\]\]/g;
  const matches = query.match(regex);
  const uniqueTitles = new Set(matches ? matches.map((match) => match.slice(2, -2)) : []);
  return Array.from(uniqueTitles);
}

/**
 * Process the variable name to generate a note path if it's enclosed in double brackets,
 * otherwise return the variable name as is.
 *
 * @param {string} variableName - The name of the variable to process
 * @return {string} The processed note path or the variable name itself
 */
export function processVariableNameForNotePath(variableName: string): string {
  variableName = variableName.trim();
  // Check if the variable name is enclosed in double brackets indicating it's a note
  if (variableName.startsWith("[[") && variableName.endsWith("]]")) {
    // It's a note, so we remove the brackets and append '.md'
    return `${variableName.slice(2, -2).trim()}.md`;
  }
  // It's a path, so we just return it as is
  return variableName;
}
