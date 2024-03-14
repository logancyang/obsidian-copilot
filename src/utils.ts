import { ChainType, Document } from "@/chainFactory";
import {
  DEFAULT_SETTINGS,
  DISPLAY_NAME_TO_MODEL,
  NOMIC_EMBED_TEXT,
  USER_SENDER,
} from "@/constants";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import { MemoryVariables } from "@langchain/core/memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseChain, RetrievalQAChain } from "langchain/chains";
import moment from "moment";
import { TFile, Vault, parseYaml } from "obsidian";

export const isFolderMatch = (
  fileFullpath: string,
  inputPath: string,
): boolean => {
  const fileSegments = fileFullpath
    .split("/")
    .map((segment) => segment.toLowerCase());
  return fileSegments.includes(inputPath.toLowerCase());
};

export async function getNoteFileFromTitle(
  vault: Vault,
  noteTitle: string,
): Promise<TFile | null> {
  // Get all markdown files in the vault
  const files = vault.getMarkdownFiles();

  // Iterate through all files to find a match by title
  for (const file of files) {
    // Extract the title from the filename by removing the extension
    const title = file.basename;

    if (title === noteTitle) {
      // If a match is found, return the file path
      return file;
    }
  }

  // If no match is found, return null
  return null;
}

export const getNotesFromPath = async (
  vault: Vault,
  path: string,
): Promise<TFile[]> => {
  const files = vault.getMarkdownFiles();

  // Special handling for the root path '/'
  if (path === "/") {
    return files;
  }

  // Split the path to get the last folder name
  const pathSegments = path.split("/");
  const lastSegment = pathSegments[pathSegments.length - 1].toLowerCase();

  return files.filter((file) => {
    // Split the file path and get the last directory name
    return (
      isFolderMatch(file.path, lastSegment) || file.basename === lastSegment
    );
  });
};

export async function getTagsFromNote(
  file: TFile,
  vault: Vault,
): Promise<string[]> {
  const fileContent = await vault.cachedRead(file);
  // Check if the file starts with frontmatter delimiter
  if (fileContent.startsWith("---")) {
    const frontMatterBlock = fileContent.split("---", 3);
    // Ensure there's a closing delimiter for frontmatter
    if (frontMatterBlock.length >= 3) {
      const frontMatterContent = frontMatterBlock[1];
      try {
        const frontMatter = parseYaml(frontMatterContent) || {};
        const tags = frontMatter.tags || [];
        // Strip any '#' from the frontmatter tags. Obsidian sometimes has '#' sometimes doesn't...
        return tags
          .map((tag: string) => tag.replace("#", ""))
          .map((tag: string) => tag.toLowerCase());
      } catch (error) {
        console.error("Error parsing YAML frontmatter:", error);
        return [];
      }
    }
  }
  return [];
}

export async function getNotesFromTags(
  vault: Vault,
  tags: string[],
  noteFiles?: TFile[],
): Promise<TFile[]> {
  if (tags.length === 0) {
    return [];
  }

  // Strip any '#' from the tags set from the user
  tags = tags.map((tag) => tag.replace("#", ""));

  const files =
    noteFiles && noteFiles.length > 0
      ? noteFiles
      : await getNotesFromPath(vault, "/");
  const filesWithTag = [];

  for (const file of files) {
    const noteTags = await getTagsFromNote(file, vault);
    if (tags.some((tag) => noteTags.includes(tag))) {
      filesWithTag.push(file);
    }
  }

  return filesWithTag;
}

export function isPathInList(filePath: string, pathList: string): boolean {
  if (!pathList) return false;

  // Extract the file name from the filePath
  const fileName = filePath.split("/").pop()?.toLowerCase();

  // Normalize the file path for case-insensitive comparison
  const normalizedFilePath = filePath.toLowerCase();

  return pathList
    .split(",")
    .map(
      (path) =>
        path
          .trim() // Trim whitespace
          .replace(/^\[\[|\]\]$/g, "") // Remove surrounding [[ and ]]
          .replace(/^\//, "") // Remove leading slash
          .toLowerCase(), // Convert to lowercase for case-insensitive comparison
    )
    .some((normalizedPath) => {
      // Check for exact match or proper segmentation
      const isExactMatch =
        normalizedFilePath === normalizedPath ||
        normalizedFilePath.startsWith(normalizedPath + "/") ||
        normalizedFilePath.endsWith("/" + normalizedPath) ||
        normalizedFilePath.includes("/" + normalizedPath + "/");
      // Check for file name match (for cases like [[note1]])
      const isFileNameMatch = fileName === normalizedPath + ".md";

      return isExactMatch || isFileNameMatch;
    });
}

export const stringToChainType = (chain: string): ChainType => {
  switch (chain) {
    case "llm_chain":
      return ChainType.LLM_CHAIN;
    case "long_note_qa":
      return ChainType.LONG_NOTE_QA_CHAIN;
    case "vault_qa":
      return ChainType.VAULT_QA_CHAIN;
    default:
      throw new Error(`Unknown chain type: ${chain}`);
  }
};

export const isLLMChain = (
  chain: RunnableSequence,
): chain is RunnableSequence => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.modelName || (chain as any).last.bound.model;
};

export const isRetrievalQAChain = (
  chain: BaseChain,
): chain is RetrievalQAChain => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.retriever !== undefined;
};

export const isSupportedChain = (
  chain: RunnableSequence,
): chain is RunnableSequence => {
  return isLLMChain(chain) || isRetrievalQAChain(chain);
};

export const getModelName = (modelDisplayName: string): string => {
  return DISPLAY_NAME_TO_MODEL[modelDisplayName];
};

// Returns the last N messages from the chat history,
// last one being the newest ai message
export const getChatContext = (
  chatHistory: ChatMessage[],
  contextSize: number,
) => {
  if (chatHistory.length === 0) {
    return [];
  }
  const lastAiMessageIndex = chatHistory
    .slice()
    .reverse()
    .findIndex((msg) => msg.sender !== USER_SENDER);
  if (lastAiMessageIndex === -1) {
    // No ai messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - 1 - lastAiMessageIndex;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);
  return chatHistory.slice(startIndex, lastIndex + 1);
};

export const formatDateTime = (
  now: Date,
  timezone: "local" | "utc" = "local",
) => {
  const formattedDateTime = moment(now);

  if (timezone === "utc") {
    formattedDateTime.utc();
  }

  return formattedDateTime.format("YYYY_MM_DD-HH_mm_ss");
};

export async function getFileContent(
  file: TFile,
  vault: Vault,
): Promise<string | null> {
  if (file.extension != "md") return null;
  return await vault.cachedRead(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

export async function getAllNotesContent(vault: Vault): Promise<string> {
  let allContent = "";

  const markdownFiles = vault.getMarkdownFiles();

  for (const file of markdownFiles) {
    const fileContent = await vault.cachedRead(file);
    allContent += fileContent + " ";
  }

  return allContent;
}

export function areEmbeddingModelsSame(
  model1: string | undefined,
  model2: string | undefined,
): boolean {
  if (!model1 || !model2) return false;
  // TODO: Hacks to handle different embedding model names for the same model. Need better handling.
  if (model1.includes(NOMIC_EMBED_TEXT) && model2.includes(NOMIC_EMBED_TEXT)) {
    return true;
  }
  if (
    (model1 === "small" && model2 === "cohereai") ||
    (model1 === "cohereai" && model2 === "small")
  ) {
    return true;
  }
  return model1 === model2;
}

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const sanitizedSettings: CopilotSettings = { ...settings };

  // Stuff in settings are string even when the interface has number type!
  const temperature = Number(settings.temperature);
  sanitizedSettings.temperature = isNaN(temperature)
    ? DEFAULT_SETTINGS.temperature
    : temperature;

  const maxTokens = Number(settings.maxTokens);
  sanitizedSettings.maxTokens = isNaN(maxTokens)
    ? DEFAULT_SETTINGS.maxTokens
    : maxTokens;

  const contextTurns = Number(settings.contextTurns);
  sanitizedSettings.contextTurns = isNaN(contextTurns)
    ? DEFAULT_SETTINGS.contextTurns
    : contextTurns;

  return sanitizedSettings;
}

// Basic prompts
// Note that GPT4 is much better at following instructions than GPT3.5!
export function sendNoteContentPrompt(
  noteName: string,
  noteContent: string | null,
): string {
  return (
    `Please read the note below and be ready to answer questions about it. ` +
    `If there's no information about a certain topic, just say the note ` +
    `does not mention it. ` +
    `The content of the note is between "/***/":\n\n/***/\n\n${noteContent}\n\n/***/\n\n` +
    `Please reply with the following word for word:` +
    `"OK I've read this note titled [[ ${noteName} ]]. ` +
    `Feel free to ask related questions, such as 'give me a summary of this note in bullet points', 'what key questions does it answer', etc. "\n`
  );
}

export function sendNotesContentPrompt(
  notes: { name: string; content: string }[],
): string {
  return (
    `Please read the notes below and be ready to answer questions about them. ` +
    `If there's no information about a certain topic, just say the note ` +
    `does not mention it. ` +
    `The content of the note is between "/***/":\n\n/***/\n\n${JSON.stringify(notes)}\n\n/***/\n\n` +
    `Please reply with the following word for word:` +
    `"OK I've read these notes. ` +
    `Feel free to ask related questions, such as 'give me a summary of these notes in bullet points', 'what key questions does these notes answer', etc. "\n`
  );
}

function getNoteTitleAndTags(noteWithTag: {
  name: string;
  content: string;
  tags?: string[];
}): string {
  return (
    `[[${noteWithTag.name}]]` +
    (noteWithTag.tags && noteWithTag.tags.length > 0
      ? `\ntags: ${noteWithTag.tags.join(",")}`
      : "")
  );
}

function getChatContextStr(
  chatNoteContextPath: string,
  chatNoteContextTags: string[],
): string {
  const pathStr = chatNoteContextPath
    ? `\nChat context by path: ${chatNoteContextPath}`
    : "";
  const tagsStr =
    chatNoteContextTags?.length > 0
      ? `\nChat context by tags: ${chatNoteContextTags}`
      : "";
  return pathStr + tagsStr;
}

export function getSendChatContextNotesPrompt(
  notes: { name: string; content: string }[],
  chatNoteContextPath: string,
  chatNoteContextTags: string[],
): string {
  const noteTitles = notes
    .map((note) => getNoteTitleAndTags(note))
    .join("\n\n");
  return (
    `Please read the notes below and be ready to answer questions about them. ` +
    getChatContextStr(chatNoteContextPath, chatNoteContextTags) +
    `\n\n${noteTitles}`
  );
}

export function fixGrammarSpellingSelectionPrompt(
  selectedText: string,
): string {
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

export function rewriteTweetSelectionPrompt(selectedText: string): string {
  return `Please rewrite the following content to under 280 characters using simple sentences. Output in the same language as the source, do not output English if it is not English. Please follow the instruction strictly. Content:\n
    + ${selectedText}`;
}

export function rewriteTweetThreadSelectionPrompt(
  selectedText: string,
): string {
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

export function rewriteLongerSelectionPrompt(selectedText: string): string {
  return (
    `Please rewrite the following text to make it twice as long while keeping the meaning as much as possible. Output in the same language as the source, do not output English if it is not English:\n` +
    `${selectedText}`
  );
}

export function eli5SelectionPrompt(selectedText: string): string {
  return (
    `Please explain the following text like I'm 5 years old. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function rewritePressReleaseSelectionPrompt(
  selectedText: string,
): string {
  return (
    `Please rewrite the following text to make it sound like a press release. Output in the same language as the source, do not output English if it is not English:\n\n` +
    `${selectedText}`
  );
}

export function createTranslateSelectionPrompt(language?: string) {
  return (selectedText: string): string => {
    return (
      `Please translate the following text to ${language}:\n\n` +
      `${selectedText}`
    );
  };
}

export function createChangeToneSelectionPrompt(tone?: string) {
  return (selectedText: string): string => {
    return (
      `Please change the tone of the following text to ${tone}. Output in the same language as the source, do not output English if it is not English:\n\n` +
      `${selectedText}`
    );
  };
}

export function extractChatHistory(
  memoryVariables: MemoryVariables,
): [string, string][] {
  const chatHistory: [string, string][] = [];
  const { history } = memoryVariables;

  for (let i = 0; i < history.length; i += 2) {
    const userMessage = history[i]?.content || "";
    const aiMessage = history[i + 1]?.content || "";
    chatHistory.push([userMessage, aiMessage]);
  }

  return chatHistory;
}

export function extractNoteTitles(query: string): string[] {
  // Use a regular expression to extract note titles wrapped in [[]]
  const regex = /\[\[(.*?)\]\]/g;
  const matches = query.match(regex);
  const uniqueTitles = new Set(
    matches ? matches.map((match) => match.slice(2, -2)) : [],
  );
  return Array.from(uniqueTitles);
}

/**
 * Process the variable name to generate a note path if it's enclosed in double brackets, otherwise return the variable name as is.
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

export function extractUniqueTitlesFromDocs(docs: Document[]): string[] {
  const titlesSet = new Set<string>();
  docs.forEach((doc) => {
    if (doc.metadata?.title) {
      titlesSet.add(doc.metadata?.title);
    }
  });

  return Array.from(titlesSet);
}
