import { ChainType, Document } from "@/chainFactory";
import {
  ChatModelProviders,
  EmbeddingModelProviders,
  NOMIC_EMBED_TEXT,
  Provider,
  ProviderInfo,
  ProviderMetadata,
  ProviderSettingsKeyMap,
  SettingKeyProviders,
  USER_SENDER,
} from "@/constants";
import { logError, logInfo } from "@/logger";
import { CopilotSettings } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemoryVariables } from "@langchain/core/memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { Buffer } from "buffer";
import { BaseChain, RetrievalQAChain } from "langchain/chains";
import moment from "moment";
import { MarkdownView, Notice, TFile, Vault, requestUrl } from "obsidian";
import { CustomModel } from "./aiParams";

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
 * @returns The tag without the hash symbol in lowercase.
 */
export function stripHash(tag: string): string {
  return tag.replace(/^#/, "").trim().toLowerCase();
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

export const isLLMChain = (chain: RunnableSequence): chain is RunnableSequence => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.modelName || (chain as any).last.bound.model;
};

export const isRetrievalQAChain = (chain: BaseChain): chain is RetrievalQAChain => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chain as any).last.bound.retriever !== undefined;
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

export function extractChatHistory(memoryVariables: MemoryVariables): [string, string][] {
  const chatHistory: [string, string][] = [];
  const { history } = memoryVariables;

  for (let i = 0; i < history.length; i += 2) {
    const userMessage = history[i]?.content || "";
    const aiMessage = history[i + 1]?.content || "";
    chatHistory.push([userMessage, aiMessage]);
  }

  return chatHistory;
}

export function extractNoteFiles(query: string, vault: Vault): TFile[] {
  // Use a regular expression to extract note titles and paths wrapped in [[]]
  const regex = /\[\[(.*?)\]\]/g;
  const matches = query.match(regex);
  const uniqueFiles = new Map<string, TFile>();

  if (matches) {
    matches.forEach((match) => {
      const inner = match.slice(2, -2);

      // First try to get file by full path
      const file = vault.getAbstractFileByPath(inner);

      if (file instanceof TFile) {
        // Found by path, use it directly
        uniqueFiles.set(file.path, file);
      } else {
        // Try to find by title
        const files = vault.getMarkdownFiles();
        const matchingFiles = files.filter((f) => f.basename === inner);

        if (matchingFiles.length > 0) {
          if (isNoteTitleUnique(inner, vault)) {
            // Only one file with this title, use it
            uniqueFiles.set(matchingFiles[0].path, matchingFiles[0]);
          } else {
            // Multiple files with same title - this shouldn't happen
            // as we should be using full paths for duplicate titles
            console.warn(
              `Found multiple files with title "${inner}". Expected a full path for duplicate titles.`
            );
          }
        }
      }
    });
  }

  return Array.from(uniqueFiles.values());
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

export function isYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

export function extractYoutubeUrl(text: string): string | null {
  const match = text.match(YOUTUBE_URL_REGEX);
  return match ? match[0] : null;
}

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface TextContent {
  type: "text";
  text: string;
}

export type MessageContent = ImageContent | TextContent;

export class ImageProcessor {
  private static readonly IMAGE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
  ];

  private static readonly MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB
  private static readonly MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };

  static async isImageUrl(url: string, vault: Vault): Promise<boolean> {
    try {
      // First check if it's an Obsidian vault image path
      if (this.IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext))) {
        // Verify the file exists and is accessible
        const file = vault.getAbstractFileByPath(url);
        if (!file || !(file instanceof TFile)) {
          logError("File not found in vault");
          return false;
        }

        // Check file size
        if (file.stat.size > this.MAX_IMAGE_SIZE) {
          logError("File too large:", file.stat.size, "bytes");
          return false;
        }

        return true;
      }

      // Then check if it's a valid URL
      const urlObj = new URL(url);

      // First check: URL path ends with image extension
      if (this.IMAGE_EXTENSIONS.some((ext) => urlObj.pathname.toLowerCase().endsWith(ext))) {
        return true;
      }

      // Second check: Try HEAD request to check content-type
      try {
        const response = await safeFetch(url, {
          method: "HEAD",
          headers: {}, // Explicitly set empty headers
        });

        const contentType = response.headers.get("content-type");
        if (contentType?.startsWith("image/")) {
          return true;
        }
      } catch (error) {
        logError("Error checking content-type:", error);
      }

      // Final check: Analyze URL patterns that commonly indicate image content
      const searchParams = urlObj.searchParams;
      const imageIndicators = [
        // Image dimensions
        searchParams.has("w") || searchParams.has("width"),
        searchParams.has("h") || searchParams.has("height"),
        // Image processing
        searchParams.has("format"),
        searchParams.has("fit"),
        // Image quality
        searchParams.has("q") || searchParams.has("quality"),
        // Common CDN image path patterns
        urlObj.pathname.includes("/image/"),
        urlObj.pathname.includes("/images/"),
        urlObj.pathname.includes("/img/"),
        // Common image processing parameters
        searchParams.has("auto"),
        searchParams.has("crop"),
      ];

      // If multiple image-related indicators are present, likely an image URL
      const imageIndicatorCount = imageIndicators.filter(Boolean).length;
      return imageIndicatorCount >= 2; // Require at least 2 indicators to consider it an image URL
    } catch {
      // If URL construction fails, it might still be a valid Obsidian vault image path
      return this.IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
    }
  }

  private static async handleVaultImage(file: TFile, vault: Vault): Promise<string | null> {
    try {
      // Check file size first
      if (file.stat.size > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${file.stat.size} bytes, skipping: ${file.path}`);
        return null;
      }

      // Read the file as array buffer
      const arrayBuffer = await vault.readBinary(file);

      // Validate MIME type
      const mimeType = await this.getMimeType(arrayBuffer, file.extension);
      if (!mimeType.startsWith("image/")) {
        logError(`Invalid MIME type: ${mimeType}, skipping: ${file.path}`);
        return null;
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");

      const result = `data:${mimeType};base64,${base64}`;
      return result;
    } catch (error) {
      logError("Error in handleVaultImage:", error);
      return null;
    }
  }

  private static async handleWebImage(imageUrl: string): Promise<string | null> {
    try {
      const response = await safeFetch(imageUrl, {
        method: "GET",
        headers: {},
      });

      if (!response.ok) {
        logError(`Failed to fetch image: ${response.statusText}, skipping: ${imageUrl}`);
        return null;
      }

      // Try to get content type from response headers
      const contentType = response.headers.get("content-type");
      if (!contentType?.startsWith("image/")) {
        logError(`Invalid content type: ${contentType}, skipping: ${imageUrl}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();

      // Check file size
      if (arrayBuffer.byteLength > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${arrayBuffer.byteLength} bytes, skipping: ${imageUrl}`);
        return null;
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      logError("Error converting image to base64:", error);
      return null;
    }
  }

  private static async handleLocalImage(imageUrl: string, vault: Vault): Promise<string | null> {
    try {
      const localPath = decodeURIComponent(imageUrl.replace("app://", ""));
      const file = vault.getAbstractFileByPath(localPath);
      if (!file || !(file instanceof TFile)) {
        logError(`Local image not found: ${localPath}`);
        return null;
      }

      // Check file size
      if (file.stat.size > this.MAX_IMAGE_SIZE) {
        logError(`Image too large: ${file.stat.size} bytes, skipping: ${localPath}`);
        return null;
      }

      // Read the file as array buffer
      const arrayBuffer = await vault.readBinary(file);

      // Validate MIME type
      const mimeType = await this.getMimeType(arrayBuffer, file.extension);
      if (!mimeType.startsWith("image/")) {
        logError(`Invalid MIME type: ${mimeType}, skipping: ${localPath}`);
        return null;
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString("base64");

      const result = `data:${mimeType};base64,${base64}`;
      return result;
    } catch (error) {
      logError("Error in handleLocalImage:", error);
      return null;
    }
  }

  private static async imageToBase64(imageUrl: string, vault: Vault): Promise<string | null> {
    // If it's already a data URL, return it as is
    if (imageUrl.startsWith("data:")) {
      return imageUrl;
    }

    // Check if it's a local vault image
    if (imageUrl.startsWith("app://")) {
      return await this.handleLocalImage(imageUrl, vault);
    }

    // Check if it's an Obsidian vault image (direct file path)
    const file = vault.getAbstractFileByPath(imageUrl);
    if (file instanceof TFile) {
      return await this.handleVaultImage(file, vault);
    }

    // Handle web images
    return await this.handleWebImage(imageUrl);
  }

  static async convertToBase64(imageUrl: string, vault: Vault): Promise<ImageContent | null> {
    const base64Url = await this.imageToBase64(imageUrl, vault);
    if (!base64Url) {
      return null;
    }
    return {
      type: "image_url",
      image_url: {
        url: base64Url,
      },
    };
  }

  private static async getMimeType(arrayBuffer: ArrayBuffer, extension: string): Promise<string> {
    // Get the first few bytes to check for magic numbers
    const bytes = new Uint8Array(arrayBuffer.slice(0, 4));

    // Check for common image magic numbers
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return "image/jpeg";
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      return "image/png";
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49) {
      return "image/gif";
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49) {
      return "image/webp";
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return "image/bmp";
    }
    if (bytes[0] === 0x3c && bytes[1] === 0x73) {
      return "image/svg+xml";
    }

    // Fall back to extension-based detection
    const mimeType = this.MIME_TYPES[extension.toLowerCase() as keyof typeof this.MIME_TYPES];
    if (!mimeType) {
      throw new Error(`Unsupported image extension: ${extension}`);
    }
    return mimeType;
  }
}

/** Proxy function to use in place of fetch() to bypass CORS restrictions.
 * It currently doesn't support streaming until this is implemented
 * https://forum.obsidian.md/t/support-streaming-the-request-and-requesturl-response-body/87381 */
export async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Initialize headers if not provided
  const headers = options.headers ? { ...options.headers } : {};

  // Remove content-length if it exists
  delete (headers as Record<string, string>)["content-length"];

  if (typeof options.body === "string") {
    const newBody = JSON.parse(options.body ?? {});
    delete newBody["frequency_penalty"];
    options.body = JSON.stringify(newBody);
  }

  logInfo("==== safeFetch method request ====");

  const method = options.method?.toUpperCase() || "POST";
  const methodsWithBody = ["POST", "PUT", "PATCH"];

  const response = await requestUrl({
    url,
    contentType: "application/json",
    headers: headers as Record<string, string>,
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

export function err2String(err: any, stack = false) {
  // maybe to be improved
  return err instanceof Error
    ? err.message +
        "\n" +
        `${err?.cause ? "more message: " + (err.cause as Error).message : ""}` +
        "\n" +
        `${stack ? err.stack : ""}`
    : JSON.stringify(err);
}

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
  if (replace) {
    editor.replaceRange(message, cursorFrom, cursorTo);
  } else {
    editor.replaceRange(message, cursorTo);
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

export function isOSeriesModel(model: BaseChatModel | string): boolean {
  if (typeof model === "string") {
    return model.startsWith("o1") || model.startsWith("o3");
  }

  // For BaseChatModel instances
  const modelName = (model as any).modelName || (model as any).model || "";
  return modelName.startsWith("o1") || modelName.startsWith("o3");
}

export function getMessageRole(
  model: BaseChatModel | string,
  defaultRole: "system" | "human" = "system"
): "system" | "human" {
  return isOSeriesModel(model) ? "human" : defaultRole;
}

export function getNeedSetKeyProvider() {
  // List of providers to exclude
  const excludeProviders: Provider[] = [
    ChatModelProviders.OPENAI_FORMAT,
    ChatModelProviders.OLLAMA,
    ChatModelProviders.LM_STUDIO,
    ChatModelProviders.AZURE_OPENAI,
    EmbeddingModelProviders.COPILOT_PLUS,
    EmbeddingModelProviders.COPILOT_PLUS_JINA,
  ];

  return Object.entries(ProviderInfo)
    .filter(([key]) => !excludeProviders.includes(key as Provider))
    .map(([key]) => key as Provider);
}

export function checkModelApiKey(
  model: CustomModel,
  settings: Readonly<CopilotSettings>
): {
  hasApiKey: boolean;
  errorNotice?: string;
} {
  const needSetKeyPath = !!getNeedSetKeyProvider().find((provider) => provider === model.provider);
  const providerKeyName = ProviderSettingsKeyMap[model.provider as SettingKeyProviders];
  const hasNoApiKey = !model.apiKey && !settings[providerKeyName];

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
 * Removes any <think> tags and their content from the text.
 * This is used to clean model outputs before using them for RAG.
 * @param text - The text to remove think tags from
 * @returns The text with think tags removed
 */
export function removeThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
