import { ChainType, Document } from "@/chainFactory";
import {
  ChatModelProviders,
  EmbeddingModelProviders,
  NOMIC_EMBED_TEXT,
  Provider,
  ProviderInfo,
  ProviderMetadata,
  SettingKeyProviders,
  USER_SENDER,
} from "@/constants";
import { logInfo } from "@/logger";
import { CopilotSettings } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemoryVariables } from "@langchain/core/memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseChain, RetrievalQAChain } from "@langchain/classic/chains";
import moment from "moment";
import { MarkdownView, Notice, TFile, Vault, normalizePath, requestUrl } from "obsidian";
import { CustomModel } from "./aiParams";
import { getApiKeyForProvider } from "@/utils/modelUtils";
export { err2String } from "@/errorFormat";

// Add custom error type at the top of the file
interface APIError extends Error {
  json?: any;
}

// Error message constants
export const ERROR_MESSAGES = {
  INVALID_LICENSE_KEY_USER:
    "Invalid Copilot Plus license key. Please check your license key in settings.",
  UNKNOWN_ERROR: "An unknown error occurred",
  REQUEST_FAILED: (status: number) => `Request failed, status ${status}`,
} as const;

// Error handling utilities
export interface ErrorDetail {
  status?: number;
  message?: string;
  reason?: string;
}

export function extractErrorDetail(error: any): ErrorDetail {
  const errorDetail = error?.detail || {};
  return {
    status: errorDetail.status,
    message: errorDetail.message || error?.message,
    reason: errorDetail.reason,
  };
}

export function isLicenseKeyError(error: any): boolean {
  const errorDetail = extractErrorDetail(error);
  return (
    errorDetail.reason === "Invalid license key" ||
    error?.message === "Invalid license key" ||
    error?.message?.includes("status 403") ||
    errorDetail.status === 403
  );
}

export function getApiErrorMessage(error: any): string {
  const errorDetail = extractErrorDetail(error);
  if (isLicenseKeyError(error)) {
    return ERROR_MESSAGES.INVALID_LICENSE_KEY_USER;
  }
  return (
    errorDetail.message ||
    (errorDetail.reason ? `Error: ${errorDetail.reason}` : ERROR_MESSAGES.UNKNOWN_ERROR)
  );
}

export const getModelNameFromKey = (modelKey: string): string => {
  return modelKey.split("|")[0];
};

export const isFolderMatch = (fileFullpath: string, inputPath: string): boolean => {
  const fileSegments = fileFullpath.split("/").map((segment) => segment.toLowerCase());
  return fileSegments.includes(inputPath.toLowerCase());
};

/** TODO: Rewrite with app.vault.getAbstractFileByPath() */
export const getNotesFromPath = (vault: Vault, path: string): TFile[] => {
  const files = vault.getMarkdownFiles();

  // Special handling for the root path '/'
  if (path === "/") {
    return files;
  }

  // Normalize the input path
  const normalizedPath = path.toLowerCase().replace(/^\/|\/$/g, "");

  return files.filter((file) => {
    // Normalize the file path
    const normalizedFilePath = file.path.toLowerCase();
    const filePathParts = normalizedFilePath.split("/");
    const pathParts = normalizedPath.split("/");

    // Check if the file path contains all parts of the input path in order
    let filePathIndex = 0;
    for (const pathPart of pathParts) {
      while (filePathIndex < filePathParts.length) {
        if (filePathParts[filePathIndex] === pathPart) {
          break;
        }
        filePathIndex++;
      }
      if (filePathIndex >= filePathParts.length) {
        return false;
      }
    }

    return true;
  });
};

/**
 * @param tag - The tag to strip the hash symbol from.
 * @returns The tag without the hash symbol.
 */
export function stripHash(tag: string): string {
  return tag.replace(/^#/, "").trim();
}

/**
 * @param file - The note file to get tags from.
 * @param frontmatterOnly - Whether to only get tags from frontmatter.
 * @returns An array of lowercase tags without the hash symbol.
 */
export function getTagsFromNote(file: TFile, frontmatterOnly = true): string[] {
  const metadata = app.metadataCache.getFileCache(file);
  const frontmatterTags = metadata?.frontmatter?.tags;
  const allTags = new Set<string>();

  if (!frontmatterOnly) {
    const inlineTags = metadata?.tags?.map((tag) => tag.tag);
    if (inlineTags) {
      inlineTags.forEach((tag) => allTags.add(stripHash(tag)));
    }
  }

  // Add frontmatter tags
  if (frontmatterTags) {
    if (Array.isArray(frontmatterTags)) {
      frontmatterTags.forEach((tag) => {
        if (typeof tag === "string") {
          allTags.add(stripHash(tag));
        }
      });
    } else if (typeof frontmatterTags === "string") {
      allTags.add(stripHash(frontmatterTags));
    }
  }

  return Array.from(allTags);
}

/**
 * Get notes from tags.
 * @param vault - The vault to get notes from.
 * @param tags - The tags to get notes from. Tags should be with the hash symbol.
 * @param noteFiles - The notes to get notes from.
 * @returns An array of note files.
 */
export function getNotesFromTags(vault: Vault, tags: string[], noteFiles?: TFile[]): TFile[] {
  if (tags.length === 0) {
    return [];
  }

  tags = tags.map((tag) => stripHash(tag));

  const files = noteFiles && noteFiles.length > 0 ? noteFiles : getNotesFromPath(vault, "/");
  const filesWithTag = [];

  for (const file of files) {
    const noteTags = getTagsFromNote(file);
    if (tags.some((tag) => noteTags.includes(tag))) {
      filesWithTag.push(file);
    }
  }

  return filesWithTag;
}

// TODO: Chain type conversion still needed for chain runner selection
// This function is still used but the underlying chain infrastructure is deprecated
export const stringToChainType = (chain: string): ChainType => {
  switch (chain) {
    case "llm_chain":
      return ChainType.LLM_CHAIN;
    case "vault_qa":
      return ChainType.VAULT_QA_CHAIN;
    case "copilot_plus":
      return ChainType.COPILOT_PLUS_CHAIN;
    default:
      throw new Error(`Unknown chain type: ${chain}`);
  }
};

// TODO: These chain validation functions are deprecated
// Remove after confirming chainManager no longer uses them
export const isLLMChain = (chain: RunnableSequence): chain is RunnableSequence => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last?.modelName || (chain as any).last?.model;
};

export const isRetrievalQAChain = (chain: BaseChain): chain is RetrievalQAChain => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last?.retriever !== undefined;
};

export const isSupportedChain = (chain: RunnableSequence): chain is RunnableSequence => {
  return isLLMChain(chain) || isRetrievalQAChain(chain);
};

// Returns the last N messages from the chat history,
// last one being the newest ai message
export const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
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

export interface FormattedDateTime {
  fileName: string;
  display: string;
  epoch: number;
}

export const formatDateTime = (
  now: Date,
  timezone: "local" | "utc" = "local"
): FormattedDateTime => {
  const formattedDateTime = moment(now);

  if (timezone === "utc") {
    formattedDateTime.utc();
  }

  return {
    fileName: formattedDateTime.format("YYYYMMDD_HHmmss"),
    display: formattedDateTime.format("YYYY/MM/DD HH:mm:ss"),
    epoch: formattedDateTime.valueOf(),
  };
};

/**
 * Ensure a folder path exists by creating any missing parent directories.
 * Works across desktop and mobile. Safe to call repeatedly.
 *
 * Examples:
 * - ensureFolderExists("copilot/copilot-conversations")
 * - ensureFolderExists("some/deep/nested/path")
 *
 * Throws if any segment conflicts with an existing file.
 */
export async function ensureFolderExists(folderPath: string): Promise<void> {
  const path = normalizePath(folderPath).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) return; // nothing to ensure

  const parts = path.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;

    const existing = app.vault.getAbstractFileByPath(current);
    if (existing) {
      if (existing instanceof TFile) {
        throw new Error(`Path conflict: "${current}" exists as a file, expected folder.`);
      }
      // If it's a folder, continue to check/create the next segment
      continue;
    }

    // Create this level; parents are guaranteed to exist from previous iterations
    await app.vault.adapter.mkdir(current);
  }
}

export function stringToFormattedDateTime(timestamp: string): FormattedDateTime {
  const date = moment(timestamp, "YYYY/MM/DD HH:mm:ss");
  if (!date.isValid()) {
    // If the string is not in the expected format, return current date/time
    return formatDateTime(new Date());
  }
  return {
    fileName: date.format("YYYYMMDD_HHmmss"),
    display: date.format("YYYY/MM/DD HH:mm:ss"),
    epoch: date.valueOf(),
  };
}

export async function getFileContent(file: TFile, vault: Vault): Promise<string | null> {
  if (file.extension != "md" && file.extension != "canvas") return null;
  return await vault.cachedRead(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

/**
 * Check if a file is allowed for note context (markdown, PDF, or canvas files).
 * This does NOT include images - images are handled separately in the UI.
 * @param file The file to check
 * @returns true if the file is allowed for note context, false otherwise
 */
export function isAllowedFileForNoteContext(file: TFile | null): boolean {
  if (!file) return false;
  return file.extension === "md" || file.extension === "pdf" || file.extension === "canvas";
}

/**
 * Checks if a chain type is a Plus mode chain (Copilot Plus or Project Chain).
 * Plus mode chains have access to premium features like PDF processing and URL processing.
 * @param chainType The chain type to check
 * @returns true if this is a Plus mode chain, false otherwise
 */
export function isPlusChain(chainType: ChainType): boolean {
  return chainType === ChainType.COPILOT_PLUS_CHAIN || chainType === ChainType.PROJECT_CHAIN;
}

/**
 * Checks if a file extension is allowed for context based on the chain type.
 * All chains support markdown and canvas files.
 * Plus chains support all file types (PDF, EPUB, PPT, DOCX, etc.).
 * Free chains only support markdown and canvas files.
 * @param file The file to check
 * @param chainType The current chain type
 * @returns true if the file is allowed for this chain type, false otherwise
 */
export function isAllowedFileForChainContext(file: TFile | null, chainType: ChainType): boolean {
  if (!file) return false;

  // All chains support markdown and canvas files
  if (file.extension === "md" || file.extension === "canvas") {
    return true;
  }

  // Plus chains support all other file types (PDF, EPUB, PPT, DOCX, etc.)
  // Free chains only support markdown and canvas
  return isPlusChain(chainType);
}

export async function getAllNotesContent(vault: Vault): Promise<string> {
  const vaultNotes: string[] = [];

  const markdownFiles = vault.getMarkdownFiles();

  for (const file of markdownFiles) {
    const fileContent = await vault.cachedRead(file);
    // Import is not available at the top level due to circular dependency
    const { VAULT_NOTE_TAG } = await import("@/constants");
    vaultNotes.push(
      `<${VAULT_NOTE_TAG}>\n<path>${file.path}</path>\n<content>\n${fileContent}\n</content>\n</${VAULT_NOTE_TAG}>`
    );
  }

  return vaultNotes.join("\n\n");
}

export function areEmbeddingModelsSame(
  model1: string | undefined,
  model2: string | undefined
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

function getNoteTitleAndTags(noteWithTag: {
  name: string;
  content: string;
  tags?: string[];
}): string {
  return (
    `[[${noteWithTag.name}]]` +
    (noteWithTag.tags && noteWithTag.tags.length > 0 ? `\ntags: ${noteWithTag.tags.join(",")}` : "")
  );
}

function getChatContextStr(chatNoteContextPath: string, chatNoteContextTags: string[]): string {
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

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * Extract text-only chat history from memory variables.
 * This function pairs messages by index (i, i+1) and returns only string content.
 *
 * Note: For multimodal chains (CopilotPlus, AutonomousAgent), use
 * chatHistoryUtils.processRawChatHistory instead to preserve image content.
 *
 * @param memoryVariables Memory variables from LangChain memory
 * @returns Array of text-only chat history entries
 */
// TODO: Deprecated, use chatHistoryUtils.processRawChatHistory instead
export function extractChatHistory(memoryVariables: MemoryVariables): ChatHistoryEntry[] {
  const chatHistory: ChatHistoryEntry[] = [];
  const { history } = memoryVariables;

  for (let i = 0; i < history.length; i += 2) {
    const userMessage = history[i]?.content || "";
    const aiMessage = history[i + 1]?.content || "";

    chatHistory.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: aiMessage }
    );
  }

  return chatHistory;
}

/**
 * Core logic for extracting note files from wikilink patterns.
 * Resolves note titles/paths to TFile objects, handling both unique titles and full paths.
 *
 * @param noteTitles - Array of note title/path strings extracted from wikilinks
 * @param vault - Obsidian vault instance
 * @returns Array of unique TFile objects
 */
function resolveNoteFilesFromTitles(noteTitles: string[], vault: Vault): TFile[] {
  const uniqueFiles = new Map<string, TFile>();

  noteTitles.forEach((noteTitle) => {
    // First try to get file by full path
    const file = vault.getAbstractFileByPath(noteTitle);

    if (file instanceof TFile) {
      // Found by path, use it directly
      uniqueFiles.set(file.path, file);
    } else {
      // Try to find by title
      const files = vault.getMarkdownFiles();
      const matchingFiles = files.filter((f) => f.basename === noteTitle);

      if (matchingFiles.length > 0) {
        if (isNoteTitleUnique(noteTitle, vault)) {
          // Only one file with this title, use it
          uniqueFiles.set(matchingFiles[0].path, matchingFiles[0]);
        } else {
          // Multiple files with same title - this shouldn't happen
          // as we should be using full paths for duplicate titles
          console.warn(
            `Found multiple files with title "${noteTitle}". Expected a full path for duplicate titles.`
          );
        }
      }
    }
  });

  return Array.from(uniqueFiles.values());
}

/**
 * Extract note files from text containing wikilinks: [[note title]]
 * Used by search/retrieval systems to find explicitly mentioned notes.
 *
 * @param query - Text containing [[...]] patterns
 * @param vault - Obsidian vault instance
 * @returns Array of unique TFile objects matching the [[...]] patterns
 */
export function extractNoteFiles(query: string, vault: Vault): TFile[] {
  // Use a regular expression to extract note titles and paths wrapped in [[]]
  const regex = /\[\[(.*?)\]\]/g;
  const matches = query.match(regex);

  if (!matches) {
    return [];
  }

  // Extract inner content from [[...]]
  const noteTitles = matches.map((match) => match.slice(2, -2));
  return resolveNoteFilesFromTitles(noteTitles, vault);
}

/**
 * Extract note files from text containing wikilinks wrapped in curly braces: {[[note title]]}
 * This is specifically for custom prompt templating where only {[[...]]} syntax should trigger
 * note content inclusion.
 *
 * @param query - Text containing {[[...]]} patterns
 * @param vault - Obsidian vault instance
 * @returns Array of unique TFile objects matching the {[[...]]} patterns
 */
export function extractTemplateNoteFiles(query: string, vault: Vault): TFile[] {
  // Use a regular expression to extract note titles and paths wrapped in {[[]]}
  const regex = /\{\[\[(.*?)\]\]\}/g;
  const matches = query.match(regex);

  if (!matches) {
    return [];
  }

  // Extract inner content from {[[...]]}
  const noteTitles = matches.map((match) => match.slice(3, -3));
  return resolveNoteFilesFromTitles(noteTitles, vault);
}

// Helper function to check if a note title is unique in the vault
export function isNoteTitleUnique(title: string, vault: Vault): boolean {
  const files = vault.getMarkdownFiles();
  return files.filter((f) => f.basename === title).length === 1;
}

// Helper function to determine if we should show the full path for a file
export function shouldShowPath(file: TFile): boolean {
  return (file as any).needsPathDisplay === true;
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

export function extractUniqueTitlesFromDocs(docs: Document[]): string[] {
  const titlesSet = new Set<string>();
  docs.forEach((doc) => {
    if (doc.metadata?.title) {
      titlesSet.add(doc.metadata?.title);
    }
  });

  return Array.from(titlesSet);
}

export function extractJsonFromCodeBlock(content: string): any {
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonContent = codeBlockMatch ? codeBlockMatch[1].trim() : content.trim();
  return JSON.parse(jsonContent);
}

const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^\s&]+)/;

/**
 * Validates a YouTube URL and returns detailed validation result
 */
export function validateYoutubeUrl(url: string): {
  isValid: boolean;
  error?: string;
  videoId?: string;
} {
  if (!url || typeof url !== "string") {
    return { isValid: false, error: "URL is required" };
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { isValid: false, error: "URL cannot be empty" };
  }

  // Extract video ID
  const videoId = extractYoutubeVideoId(trimmedUrl);
  if (!videoId) {
    return { isValid: false, error: "Invalid YouTube URL format" };
  }

  // Check if video ID is valid (11 characters, alphanumeric with dashes and underscores)
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { isValid: false, error: "Invalid YouTube video ID" };
  }

  return { isValid: true, videoId };
}

/**
 * Extract YouTube video ID from various URL formats
 */
export function extractYoutubeVideoId(url: string): string | null {
  try {
    // Handle different YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Create a standard YouTube URL from video ID
 */
export function formatYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Check if a string is a valid YouTube URL (legacy function for backward compatibility)
 */
export function isYoutubeUrl(url: string): boolean {
  return validateYoutubeUrl(url).isValid;
}

/**
 * Extract first YouTube URL from text (legacy function for backward compatibility)
 */
export function extractYoutubeUrl(text: string): string | null {
  const match = text.match(YOUTUBE_URL_REGEX);
  return match ? match[0] : null;
}

/**
 * Extract all YouTube URLs from text (legacy function for backward compatibility)
 */
export function extractAllYoutubeUrls(text: string): string[] {
  const matches = text.matchAll(new RegExp(YOUTUBE_URL_REGEX, "g"));
  return Array.from(matches, (match) => match[0]);
}

/** Proxy function to use in place of fetch() to bypass CORS restrictions.
 * It currently doesn't support streaming until this is implemented
 * https://forum.obsidian.md/t/support-streaming-the-request-and-requesturl-response-body/87381 */
export async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Initialize headers if not provided
  const normalizedHeaders = new Headers(options.headers);
  const headers = Object.fromEntries(normalizedHeaders.entries());

  // Remove content-length if it exists
  delete (headers as Record<string, string>)["content-length"];

  logInfo("safeFetch request");

  const method = options.method?.toUpperCase() || "POST";
  const methodsWithBody = ["POST", "PUT", "PATCH"];

  const response = await requestUrl({
    url,
    contentType: "application/json",
    headers: headers,
    method: method,
    ...(methodsWithBody.includes(method) && { body: options.body?.toString() }),
    throw: false, // Don't throw so we can get the response body
  });

  // Check if response is error status
  if (response.status >= 400) {
    let errorJson;
    try {
      errorJson = typeof response.json === "string" ? JSON.parse(response.json) : response.json;
    } catch {
      try {
        errorJson = typeof response.text === "string" ? JSON.parse(response.text) : response.text;
      } catch {
        errorJson = null;
      }
    }

    // Create error with proper structure
    const error = new Error(ERROR_MESSAGES.REQUEST_FAILED(response.status)) as APIError;
    error.json = errorJson;

    // Handle nested error structure
    if (
      errorJson?.detail?.reason === "Invalid license key" ||
      errorJson?.reason === "Invalid license key"
    ) {
      error.message = "Invalid license key";
    } else if (errorJson?.detail?.message || errorJson?.message) {
      const message = errorJson?.detail?.message || errorJson?.message;
      const reason = errorJson?.detail?.reason || errorJson?.reason;
      error.message = reason ? `${message}: ${reason}` : message;
    } else if (errorJson?.detail) {
      error.message = JSON.stringify(errorJson.detail);
    } else if (errorJson) {
      // for external error, add more msg
      error.message += ". " + JSON.stringify(errorJson);
    }

    throw error;
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.status.toString(),
    headers: new Headers(response.headers),
    url: url,
    type: "basic" as ResponseType,
    redirected: false,
    bytes: () => Promise.resolve(new Uint8Array(0)),
    body: createReadableStreamFromString(response.text),
    bodyUsed: true,
    json: () => response.json,
    text: async () => response.text,
    arrayBuffer: async () => {
      if (response.arrayBuffer) {
        return response.arrayBuffer;
      }
      const base64 = response.text.replace(/^data:.*;base64,/, "");
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    },
    blob: () => {
      throw new Error("not implemented");
    },
    formData: () => {
      throw new Error("not implemented");
    },
    clone: () => {
      throw new Error("not implemented");
    },
  };
}

function createReadableStreamFromString(input: string) {
  return new ReadableStream({
    start(controller) {
      // Convert the input string to a Uint8Array
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(input);

      // Push the data to the stream
      controller.enqueue(uint8Array);

      // Close the stream
      controller.close();
    },
  });
}

// err2String is now exported from '@/errorFormat' to avoid circular dependencies and duplication.

export function omit<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  keys.forEach((key) => {
    delete result[key];
  });
  return result;
}

export function findCustomModel(modelKey: string, activeModels: CustomModel[]): CustomModel {
  const [modelName, provider] = modelKey.split("|");
  const model = activeModels.find((m) => m.name === modelName && m.provider === provider);
  if (!model) {
    throw new Error(`No model configuration found for: ${modelKey}`);
  }
  return model;
}

export function getProviderInfo(provider: string): ProviderMetadata {
  const info = ProviderInfo[provider as Provider];
  return {
    ...info,
    label: info.label || provider,
  };
}

export function getProviderLabel(provider: string, model?: CustomModel): string {
  const baseLabel = ProviderInfo[provider as Provider]?.label || provider;
  return baseLabel + (model?.believerExclusive && baseLabel === "Copilot Plus" ? "(Believer)" : "");
}

export function getProviderHost(provider: string): string {
  return ProviderInfo[provider as Provider]?.host || "";
}

export function getProviderKeyManagementURL(provider: string): string {
  return ProviderInfo[provider as Provider]?.keyManagementURL || "";
}

/**
 * Cleans a message by removing Think blocks, Action blocks (writeToFile), and tool call markers
 * for copying to clipboard. This is more comprehensive than removeThinkTags which is used for RAG.
 */
export function cleanMessageForCopy(message: string): string {
  let cleanedMessage = message;

  // First use the existing removeThinkTags function
  cleanedMessage = removeThinkTags(cleanedMessage);

  // Remove writeToFile blocks wrapped in XML codeblocks
  cleanedMessage = cleanedMessage.replace(
    /```xml\s*[\s\S]*?<writeToFile>[\s\S]*?<\/writeToFile>[\s\S]*?```/g,
    ""
  );

  // Remove standalone writeToFile blocks
  cleanedMessage = cleanedMessage.replace(/<writeToFile>[\s\S]*?<\/writeToFile>/g, "");

  // Remove tool call markers
  // Format: <!--TOOL_CALL_START:id:toolName:displayName:emoji:confirmationMessage:isExecuting-->content<!--TOOL_CALL_END:id:result-->
  cleanedMessage = cleanedMessage.replace(
    /<!--TOOL_CALL_START:[^:]+:[^:]+:[^:]+:[^:]+:[^:]*:[^:]+-->[\s\S]*?<!--TOOL_CALL_END:[^:]+:[\s\S]*?-->/g,
    ""
  );

  // Clean up any resulting multiple consecutive newlines (more than 2)
  cleanedMessage = cleanedMessage.replace(/\n{3,}/g, "\n\n");

  // Trim leading and trailing whitespace
  cleanedMessage = cleanedMessage.trim();

  return cleanedMessage;
}

export async function insertIntoEditor(message: string, replace: boolean = false) {
  let leaf = app.workspace.getMostRecentLeaf();
  if (!leaf) {
    new Notice("No active leaf found.");
    return;
  }

  if (!(leaf.view instanceof MarkdownView)) {
    leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "markdown", state: leaf.view.getState() });
  }

  if (!(leaf.view instanceof MarkdownView)) {
    new Notice("Failed to open a markdown view.");
    return;
  }

  const editor = leaf.view.editor;
  const cursorFrom = editor.getCursor("from");
  const cursorTo = editor.getCursor("to");

  // Clean the message before inserting (removes think tags, writeToFile blocks, tool calls)
  const cleanedMessage = cleanMessageForCopy(message);

  if (replace) {
    editor.replaceRange(cleanedMessage, cursorFrom, cursorTo);
  } else {
    editor.replaceRange(cleanedMessage, cursorTo);
  }
  new Notice("Message inserted into the active note.");
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Compare two semantic version strings.
 * @returns true if latest version is newer than current version
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split(".").map(Number);
  const currentParts = current.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true;
    if (latestParts[i] < currentParts[i]) return false;
  }
  return false;
}

/**
 * Check for latest version from GitHub releases.
 * @returns latest version string or error message
 */
export async function checkLatestVersion(): Promise<{
  version: string | null;
  error: string | null;
}> {
  try {
    const response = await requestUrl({
      url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest",
      method: "GET",
    });
    const version = response.json.tag_name.replace("v", "");
    return { version, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to check for updates";
    return { version: null, error: errorMessage };
  }
}

// Note: LangChain 0.6.6+ handles O-series and GPT-5 models automatically
// These functions are kept for backward compatibility and specific checks
export function isOSeriesModel(model: BaseChatModel | string): boolean {
  if (typeof model === "string") {
    return model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
  }

  // For BaseChatModel instances
  const modelName = (model as any).modelName || (model as any).model || "";
  return modelName.startsWith("o1") || modelName.startsWith("o3") || modelName.startsWith("o4");
}

export function isGPT5Model(model: BaseChatModel | string): boolean {
  if (typeof model === "string") {
    return model.startsWith("gpt-5");
  }

  // For BaseChatModel instances
  const modelName = (model as any).modelName || (model as any).model || "";
  return modelName.startsWith("gpt-5");
}

/**
 * Utility for determining model characteristics
 * Note: Most of this is handled by LangChain 0.6.6+ internally
 */
export interface ModelInfo {
  isOSeries: boolean;
  isGPT5: boolean;
  isThinkingEnabled: boolean;
}

export function getModelInfo(model: BaseChatModel | string): ModelInfo {
  const modelName =
    typeof model === "string" ? model : (model as any).modelName || (model as any).model || "";

  const isOSeries = isOSeriesModel(modelName);
  const isGPT5 = isGPT5Model(modelName);
  const isThinkingEnabled =
    modelName.startsWith("claude-3-7-sonnet") || modelName.startsWith("claude-sonnet-4");

  return {
    isOSeries,
    isGPT5,
    isThinkingEnabled,
  };
}

export function getMessageRole(
  model: BaseChatModel | string,
  defaultRole: "system" | "human" = "system"
): "system" | "human" {
  return isOSeriesModel(model) ? "human" : defaultRole;
}

export function getNeedSetKeyProvider(): Provider[] {
  // List of providers to exclude
  const excludeProviders: Provider[] = [
    ChatModelProviders.OPENAI_FORMAT,
    ChatModelProviders.OLLAMA,
    ChatModelProviders.LM_STUDIO,
    ChatModelProviders.AZURE_OPENAI,
    EmbeddingModelProviders.COPILOT_PLUS,
    EmbeddingModelProviders.COPILOT_PLUS_JINA,
  ];

  return (Object.keys(ProviderInfo) as Provider[]).filter((key) => !excludeProviders.includes(key));
}

export function checkModelApiKey(
  model: CustomModel,
  settings: Readonly<CopilotSettings>
): {
  hasApiKey: boolean;
  errorNotice?: string;
} {
  if (model.provider === ChatModelProviders.AMAZON_BEDROCK) {
    const apiKey = model.apiKey || settings.amazonBedrockApiKey;
    if (!apiKey) {
      return {
        hasApiKey: false,
        errorNotice:
          "Amazon Bedrock API key is missing. Please add a key in Settings > API Keys or update the model configuration.",
      };
    }

    // Region defaults to us-east-1 if not specified, so API key is the only required check
    return { hasApiKey: true };
  }

  const needSetKeyPath = !!getNeedSetKeyProvider().find((provider) => provider === model.provider);
  const hasNoApiKey = !getApiKeyForProvider(model.provider as SettingKeyProviders, model);

  // For Providers that require setting a key in the dialog, an inspection is necessary.
  if (needSetKeyPath && hasNoApiKey) {
    const notice =
      `Please configure API Key for ${model.name} in settings first.` +
      "\nPath: Settings > copilot plugin > Basic Tab > Set Keys";
    return {
      hasApiKey: false,
      errorNotice: notice,
    };
  }

  return {
    hasApiKey: true,
  };
}

/**
 * Extracts text content from a message chunk that could be either a string
 * or an array of content objects (Claude 3.7 format)
 */
export function extractTextFromChunk(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("");
  }
  // For any other type, try to convert to string or return empty
  return String(content || "");
}

/**
 * Removes any <think> tags and their content from the text.
 * This is used to clean model outputs before using them for RAG.
 * Handles both string content and array-based content (Claude 3.7 format)
 * @param text - The text or content array to remove think tags from
 * @returns The text with think tags removed
 */
export function removeThinkTags(text: any): string {
  // First convert any content format to plain text
  const plainText = extractTextFromChunk(text);
  // Remove complete think tags and their content
  let cleanedText = plainText.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Remove any remaining unclosed think tags (for streaming scenarios)
  cleanedText = cleanedText.replace(/<think>[\s\S]*$/g, "");
  return cleanedText.trim();
}

/**
 * Removes any <errorChunk> tags and their content from the text.
 * This is used to clean model outputs before using them for RAG.
 * Handles both string content and array-based content (Claude 3.7 format)
 * @param text - The text or content array to remove error tags from
 * @returns The text with error tags removed
 */
export function removeErrorTags(text: any): string {
  // First convert any content format to plain text
  const plainText = extractTextFromChunk(text);
  // Then remove error tags
  return plainText.replace(/<errorChunk>[\s\S]*?<\/errorChunk>/g, "").trim();
}

export function randomUUID() {
  return crypto.randomUUID();
}

/**
 * Executes a function with token counting warnings suppressed
 * This can be used anywhere in the codebase where token counting warnings should be suppressed
 * @param fn The function to execute without token counting warnings
 * @returns The result of the function
 */
export async function withSuppressedTokenWarnings<T>(fn: () => Promise<T>): Promise<T> {
  // Store original console.warn
  const originalWarn = console.warn;

  try {
    // Replace with filtered version
    console.warn = function (...args) {
      // Ignore token counting warnings
      if (
        args[0]?.includes &&
        (args[0].includes("Failed to calculate number of tokens") ||
          args[0].includes("Unknown model"))
      ) {
        return;
      }
      // Pass through other warnings
      return originalWarn.apply(console, args);
    };

    // Execute the provided function
    return await fn();
  } finally {
    // Always restore original console.warn, even if an error occurs
    console.warn = originalWarn;
  }
}

/**
 * Execute an operation with a timeout using AbortController for proper cancellation
 * @param operation - Function that accepts an AbortSignal and returns a Promise
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for error messages
 * @returns Promise that resolves with the operation result or rejects with TimeoutError
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName: string = "Operation"
): Promise<T> {
  const { TimeoutError } = await import("@/error");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new TimeoutError(operationName, timeoutMs));
        });
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if the current Obsidian editor setting is in source mode
 */
export function isSourceModeOn(): boolean {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return true;

  const state = view.getState() as { source?: boolean };
  return state.source === true;
}

/**
 * Calculate the UTF-8 byte length of a string.
 * This is important for filesystem operations where filename limits are in bytes, not characters.
 * @param str - The string to measure
 * @returns The byte length when encoded as UTF-8
 */
export function getUtf8ByteLength(str: string): number {
  // Use TextEncoder which always uses UTF-8 encoding
  return new TextEncoder().encode(str).length;
}

/**
 * Truncate a string to fit within a byte limit, ensuring UTF-8 character boundaries are respected.
 * This prevents cutting multibyte UTF-8 sequences in the middle.
 * @param str - The string to truncate
 * @param byteLimit - Maximum number of bytes (not characters)
 * @returns The truncated string that fits within the byte limit
 */
export function truncateToByteLimit(str: string, byteLimit: number): string {
  if (byteLimit <= 0) {
    return "";
  }

  // Fast path: if string already fits, return as-is
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= byteLimit) {
    return str;
  }

  // Binary search to find the longest prefix that fits
  let low = 0;
  let high = str.length;
  let result = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = str.substring(0, mid);
    const candidateBytes = encoder.encode(candidate);

    if (candidateBytes.length <= byteLimit) {
      // This candidate fits, try a longer one
      result = candidate;
      low = mid + 1;
    } else {
      // This candidate is too long, try a shorter one
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Opens a file in the workspace, reusing an existing tab if the file is already open.
 * @param file - The TFile to open
 * @param focusIfOpen - If true, focuses the existing leaf if the file is already open (default: true)
 */
export async function openFileInWorkspace(file: TFile, focusIfOpen: boolean = true): Promise<void> {
  // Check if the file is already open in any leaf
  let existingLeaf = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (
      leaf.view.getViewType() === "markdown" ||
      leaf.view.getViewType() === "pdf" ||
      leaf.view.getViewType() === "canvas"
    ) {
      const viewFile = (leaf.view as any).file;
      if (viewFile && viewFile.path === file.path) {
        existingLeaf = leaf;
      }
    }
  });

  if (existingLeaf && focusIfOpen) {
    // File is already open, focus the existing leaf
    app.workspace.setActiveLeaf(existingLeaf, { focus: true });
  } else if (!existingLeaf) {
    // File is not open, open it in a new tab
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
}
