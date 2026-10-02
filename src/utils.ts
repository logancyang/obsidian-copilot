import { compareSemver } from "@/utils/semver";
import { Buffer } from "buffer/";

import { ChainType } from "@/chainType";
import {
  ALLOWED_NOTE_CONTEXT_EXTENSIONS,
  ModelCapability,
  TEXT_READABLE_EXTENSIONS,
} from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { formatUsageCapError } from "@/utils/usageCapError";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemoryVariables } from "@langchain/core/memory";
import { DateTime } from "luxon";
import { App, MarkdownView, Notice, TFile, Vault, normalizePath, requestUrl } from "obsidian";
import { CustomModel } from "./aiParams";
export { err2String } from "@/lib/model-display-utils";

export function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface APIError extends Error {
  json?: unknown;
}

const ERROR_MESSAGES = {
  INVALID_LICENSE_KEY_USER:
    "Invalid Copilot Plus license key. Please check your license key in settings.",
  UNKNOWN_ERROR: "An unknown error occurred",
  REQUEST_FAILED: (status: number) => `Request failed, status ${status}`,
} as const;

interface ErrorDetail {
  status?: number;
  message?: string;
  reason?: string;
}

function extractErrorDetail(error: unknown): ErrorDetail {
  const err = error as Record<string, unknown> | null | undefined;
  const errorDetail: ErrorDetail = (err?.detail as ErrorDetail) || {};
  return {
    status: errorDetail.status,
    message: errorDetail.message || (err?.message as string | undefined),
    reason: errorDetail.reason,
  };
}

function isLicenseKeyError(error: unknown): boolean {
  const errorDetail = extractErrorDetail(error);
  const err = error as Record<string, unknown> | null | undefined;
  const message = err?.message as string | undefined;
  return Boolean(
    errorDetail.reason === "Invalid license key" ||
    message === "Invalid license key" ||
    message?.includes("status 403") ||
    errorDetail.status === 403
  );
}

export function getApiErrorMessage(error: unknown): string {
  if (isLicenseKeyError(error)) {
    return ERROR_MESSAGES.INVALID_LICENSE_KEY_USER;
  }
  const capMessage = formatUsageCapError(error);
  if (capMessage) {
    return capMessage;
  }
  const errorDetail = extractErrorDetail(error);
  return (
    errorDetail.message ||
    (errorDetail.reason ? `Error: ${errorDetail.reason}` : ERROR_MESSAGES.UNKNOWN_ERROR)
  );
}

export const getNotesFromPath = (vault: Vault, path: string): TFile[] => {
  const files = vault.getMarkdownFiles();

  if (path === "/") {
    return files;
  }

  const normalizedPath = path.toLowerCase().replace(/^\/|\/$/g, "");

  return files.filter((file) => {
    const normalizedFilePath = file.path.toLowerCase();
    const filePathParts = normalizedFilePath.split("/");
    const pathParts = normalizedPath.split("/");

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

export function stripHash(tag: string): string {
  return tag.replace(/^#/, "").trim();
}

interface StripFrontmatterOptions {
  trimStart?: boolean;
}

export function stripFrontmatter(content: string, options: StripFrontmatterOptions = {}): string {
  const { trimStart = true } = options;

  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) {
      const body = content.slice(end + 3);

      if (trimStart) {
        return body.trimStart();
      }

      if (body.startsWith("\r\n")) {
        return body.slice(2);
      }
      if (body.startsWith("\n") || body.startsWith("\r")) {
        return body.slice(1);
      }
      return body;
    }
  }
  return content;
}

export function getTagsFromNote(app: App, file: TFile, frontmatterOnly = true): string[] {
  const metadata = app.metadataCache.getFileCache(file);
  const frontmatterTags = metadata?.frontmatter?.tags;
  const allTags = new Set<string>();

  if (!frontmatterOnly) {
    const inlineTags = metadata?.tags?.map((tag) => tag.tag);
    if (inlineTags) {
      inlineTags.forEach((tag) => allTags.add(stripHash(tag)));
    }
  }

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

const EMPTY_PROPERTY_VALUES = Object.freeze([]) as unknown as string[];

export function getPropertyValuesFromNote(app: App, file: TFile, key: string): string[] {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter || !Object.hasOwn(frontmatter, key)) {
    return EMPTY_PROPERTY_VALUES;
  }
  const raw = (frontmatter as Record<string, unknown>)[key];
  const values: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
  const scalars = values.filter(isScalarPropertyValue);
  if (scalars.length === 0) {
    return EMPTY_PROPERTY_VALUES;
  }
  return scalars.map((value) => String(value));
}

function isScalarPropertyValue(value: unknown): value is string | number | boolean {
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}

export function noteHasProperty(app: App, file: TFile, key: string): boolean {
  const frontmatter: Record<string, unknown> | undefined =
    app.metadataCache.getFileCache(file)?.frontmatter;
  return frontmatter != null && Object.hasOwn(frontmatter, key);
}

export function getNotesFromTags(app: App, tags: string[], noteFiles?: TFile[]): TFile[] {
  if (tags.length === 0) {
    return [];
  }

  tags = tags.map((tag) => stripHash(tag));

  const files = noteFiles && noteFiles.length > 0 ? noteFiles : getNotesFromPath(app.vault, "/");
  const filesWithTag = [];

  for (const file of files) {
    const noteTags = getTagsFromNote(app, file);
    if (tags.some((tag) => noteTags.includes(tag))) {
      filesWithTag.push(file);
    }
  }

  return filesWithTag;
}

export interface FormattedDateTime {
  fileName: string;
  display: string;
  epoch: number;
}

export const formatDateTime = (
  now: Date,
  timezone: "local" | "utc" = "local"
): FormattedDateTime => {
  const dt = timezone === "utc" ? DateTime.fromJSDate(now).toUTC() : DateTime.fromJSDate(now);

  return {
    fileName: dt.toFormat("yyyyMMdd_HHmmss"),
    display: dt.toFormat("yyyy/MM/dd HH:mm:ss"),
    epoch: dt.toMillis(),
  };
};

export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
  const path = normalizePath(folderPath).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) return;

  const parts = path.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;

    const existing = vault.getAbstractFileByPath(current);
    if (existing) {
      if (existing instanceof TFile) {
        throw new Error(`Path conflict: "${current}" exists as a file, expected folder.`);
      }
      continue;
    }

    await vault.adapter.mkdir(current);
  }
}

export function isTextReadableFile(file: TFile | null): boolean {
  if (!file) return false;
  return TEXT_READABLE_EXTENSIONS.includes(file.extension);
}

export async function getFileContent(file: TFile, vault: Vault): Promise<string | null> {
  if (!isTextReadableFile(file)) return null;
  return await vault.read(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

export function isAllowedFileForNoteContext(file: TFile | null): boolean {
  if (!file) return false;
  return ALLOWED_NOTE_CONTEXT_EXTENSIONS.includes(file.extension);
}

export function isPlusChain(chainType: ChainType): boolean {
  return chainType === ChainType.COPILOT_PLUS_CHAIN;
}

export function isAllowedFileForChainContext(file: TFile | null, chainType: ChainType): boolean {
  if (!file) return false;

  if (isTextReadableFile(file)) {
    return true;
  }

  return isPlusChain(chainType);
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export function extractChatHistory(memoryVariables: MemoryVariables): ChatHistoryEntry[] {
  const chatHistory: ChatHistoryEntry[] = [];
  const history = memoryVariables.history as Array<{ content?: string }>;

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

function resolveNoteFilesFromTitles(noteTitles: string[], vault: Vault): TFile[] {
  const uniqueFiles = new Map<string, TFile>();

  noteTitles.forEach((noteTitle) => {
    const file = vault.getAbstractFileByPath(noteTitle);

    if (file instanceof TFile) {
      uniqueFiles.set(file.path, file);
    } else {
      const files = vault.getMarkdownFiles();
      const matchingFiles = files.filter((f) => f.basename === noteTitle);

      if (matchingFiles.length > 0) {
        if (isNoteTitleUnique(noteTitle, vault)) {
          uniqueFiles.set(matchingFiles[0].path, matchingFiles[0]);
        } else {
          logWarn(
            `Found multiple files with title "${noteTitle}". Expected a full path for duplicate titles.`
          );
        }
      }
    }
  });

  return Array.from(uniqueFiles.values());
}

export function extractNoteFiles(query: string, vault: Vault): TFile[] {
  const regex = /\[\[(.*?)\]\]/g;
  const matches = query.match(regex);

  if (!matches) {
    return [];
  }

  const noteTitles = matches.map((match) => match.slice(2, -2));
  return resolveNoteFilesFromTitles(noteTitles, vault);
}

export function extractTemplateNoteFiles(query: string, vault: Vault): TFile[] {
  const regex = /\{\[\[(.*?)\]\]\}/g;
  const matches = query.match(regex);

  if (!matches) {
    return [];
  }

  const noteTitles = matches.map((match) => match.slice(3, -3));
  return resolveNoteFilesFromTitles(noteTitles, vault);
}

function isNoteTitleUnique(title: string, vault: Vault): boolean {
  const files = vault.getMarkdownFiles();
  return files.filter((f) => f.basename === title).length === 1;
}

export function processVariableNameForNotePath(variableName: string): string {
  variableName = variableName.trim();
  if (variableName.startsWith("[[") && variableName.endsWith("]]")) {
    return `${variableName.slice(2, -2).trim()}.md`;
  }
  return variableName;
}

const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([^\s&]+)/;

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

  const videoId = extractYoutubeVideoId(trimmedUrl);
  if (!videoId) {
    return { isValid: false, error: "Invalid YouTube URL format" };
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { isValid: false, error: "Invalid YouTube video ID" };
  }

  return { isValid: true, videoId };
}

export function extractYoutubeVideoId(url: string): string | null {
  try {
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

export function formatYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function isYoutubeUrl(url: string): boolean {
  return validateYoutubeUrl(url).isValid;
}

export function isTwitterUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const urlObj = new URL(url.trim());
    return (
      (urlObj.hostname === "x.com" ||
        urlObj.hostname === "www.x.com" ||
        urlObj.hostname === "twitter.com" ||
        urlObj.hostname === "www.twitter.com") &&
      urlObj.pathname.includes("/status/")
    );
  } catch {
    return false;
  }
}

export function extractAllYoutubeUrls(text: string): string[] {
  const matches = text.matchAll(new RegExp(YOUTUBE_URL_REGEX, "g"));
  return Array.from(matches, (match) => match[0]);
}

export async function safeFetch(
  url: string,
  options: RequestInit & { throwOnHttpError?: boolean } = {}
): Promise<Response> {
  const { throwOnHttpError = true } = options;
  const normalizedHeaders = new Headers(options.headers);
  const headers = Object.fromEntries(normalizedHeaders.entries());

  delete (headers as Record<string, string>)["content-length"];

  logInfo("safeFetch request");

  const method = options.method?.toUpperCase() || "POST";
  const methodsWithBody = ["POST", "PUT", "PATCH"];

  const response = await requestUrl({
    url,
    contentType: "application/json",
    headers: headers,
    method: method,
    ...(methodsWithBody.includes(method) &&
      typeof options.body === "string" && { body: options.body }),
    throw: false,
  });

  if (throwOnHttpError && response.status >= 400) {
    type ErrorJson = {
      detail?: { reason?: string; message?: string } | string;
      reason?: string;
      message?: string;
    };
    let errorJson: ErrorJson | null = null;
    try {
      errorJson = (
        typeof response.json === "string" ? JSON.parse(response.json) : response.json
      ) as ErrorJson;
    } catch {
      try {
        errorJson = (
          typeof response.text === "string" ? JSON.parse(response.text) : response.text
        ) as ErrorJson;
      } catch {
        errorJson = null;
      }
    }

    const error = new Error(ERROR_MESSAGES.REQUEST_FAILED(response.status)) as APIError;
    error.json = errorJson;

    const detail = errorJson && typeof errorJson.detail === "object" ? errorJson.detail : undefined;
    if (detail?.reason === "Invalid license key" || errorJson?.reason === "Invalid license key") {
      error.message = "Invalid license key";
    } else if (detail?.message || errorJson?.message) {
      const message = detail?.message || errorJson?.message;
      const reason = detail?.reason || errorJson?.reason;
      error.message = reason ? `${message}: ${reason}` : (message ?? "");
    } else if (errorJson?.detail) {
      error.message = JSON.stringify(errorJson.detail);
    } else if (errorJson) {
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
    json: (): Promise<unknown> => Promise.resolve(response.json as unknown),
    text: async () => response.text,
    arrayBuffer: async () => {
      if (response.arrayBuffer) {
        return response.arrayBuffer;
      }
      const base64 = response.text.replace(/^data:.*;base64,/, "");
      const buf = Buffer.from(base64, "base64");
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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

/**
 * Wrapper around safeFetch that doesn't throw on HTTP errors (fetch-like behavior).
 *
 * The variant to hand a provider SDK as its `fetch`: an SDK given a throwing implementation
 * reads a 4xx as a dead connection and burns its retry budget on it.
 * https://github.com/logancyang/obsidian-copilot/issues/2959
 */
export function safeFetchNoThrow(url: string, options: RequestInit = {}): Promise<Response> {
  return safeFetch(url, { ...options, throwOnHttpError: false });
}

function createReadableStreamFromString(input: string) {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(input);

      controller.enqueue(uint8Array);

      controller.close();
    },
  });
}

export function modelSupportsVision(model: CustomModel): boolean {
  return !!model.capabilities?.includes(ModelCapability.VISION);
}

export function cleanMessageForCopy(message: string): string {
  let cleanedMessage = message;

  cleanedMessage = removeThinkTags(cleanedMessage);

  cleanedMessage = cleanedMessage.replace(
    /```xml\s*[\s\S]*?<write(?:File|ToFile)>[\s\S]*?<\/write(?:File|ToFile)>[\s\S]*?```/g,
    ""
  );

  cleanedMessage = cleanedMessage.replace(
    /<write(?:File|ToFile)>[\s\S]*?<\/write(?:File|ToFile)>/g,
    ""
  );

  cleanedMessage = cleanedMessage.replace(
    /<!--TOOL_CALL_START:[^:]+:[^:]+:[^:]+:[^:]+:[^:]*:[^:]+-->[\s\S]*?<!--TOOL_CALL_END:[^:]+:[\s\S]*?-->/g,
    ""
  );

  cleanedMessage = cleanedMessage.replace(/<!--AGENT_REASONING:\w+:\d+:.*-->/g, "");

  cleanedMessage = cleanedMessage.replace(/\n{3,}/g, "\n\n");

  cleanedMessage = cleanedMessage.trim();

  return cleanedMessage;
}

export async function insertAtCursor(app: App, text: string) {
  let leaf = app.workspace.getMostRecentLeaf();
  if (!leaf || !(leaf.view instanceof MarkdownView)) {
    leaf = app.workspace.getLeaf(false);
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
  }
  const hasSelection = leaf.view.editor.getSelection().length > 0;
  await insertIntoEditor(app, text, hasSelection);
}

export async function insertIntoEditor(app: App, message: string, replace: boolean = false) {
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

  const cleanedMessage = cleanMessageForCopy(message);
  const cleanedLines = cleanedMessage.split("\n");

  const getEndPosition = (
    start: { line: number; ch: number },
    textLines: string[]
  ): { line: number; ch: number } => {
    const lineDelta = textLines.length - 1;
    if (lineDelta === 0) {
      return { line: start.line, ch: start.ch + (textLines[0]?.length ?? 0) };
    }
    return { line: start.line + lineDelta, ch: textLines[textLines.length - 1]?.length ?? 0 };
  };

  const insertWithEditorAPI = (): void => {
    const changeFrom = replace ? cursorFrom : cursorTo;
    editor.replaceRange(cleanedMessage, changeFrom, cursorTo);
    editor.setSelection(changeFrom, getEndPosition(changeFrom, cleanedLines));
  };

  const finalizeInsertion = (): void => {
    editor.focus();
    new Notice("Message inserted into the active note.");
  };

  const view = editor.cm;
  const isCM6View = view?.state?.doc && typeof view.dispatch === "function";

  if (!isCM6View) {
    insertWithEditorAPI();
    finalizeInsertion();
    return;
  }

  const { from, to } = view.state.selection.main;
  const changeFrom = replace ? from : to;

  const insertText = view.state.toText(cleanedMessage);
  const endOffset = changeFrom + insertText.length;

  try {
    view.dispatch({
      changes: { from: changeFrom, to, insert: insertText },
      selection: { anchor: changeFrom, head: endOffset },
    });
  } catch (e) {
    logWarn("CM6 dispatch failed, falling back to Obsidian API", e);
    insertWithEditorAPI();
  }

  finalizeInsertion();
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest";

export interface LatestRelease {
  body: string;
  htmlUrl: string;
  version: string;
}

interface GitHubReleaseResponse {
  body?: unknown;
  html_url?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown }[];
}

export async function checkLatestVersion(): Promise<{
  version: string | null;
  error: string | null;
  release: LatestRelease | null;
}> {
  try {
    const response = await requestUrl({
      url: LATEST_RELEASE_API_URL,
      method: "GET",
    });
    const responseRelease = response.json as GitHubReleaseResponse;
    const manifestAsset = Array.isArray(responseRelease?.assets)
      ? responseRelease.assets.find((asset) => asset?.name === "manifest.json")
      : undefined;
    if (
      typeof manifestAsset?.browser_download_url !== "string" ||
      !manifestAsset.browser_download_url
    ) {
      throw new Error("The latest Copilot release has no manifest.json asset.");
    }
    const manifestResponse = await requestUrl({
      url: manifestAsset.browser_download_url,
      method: "GET",
    });
    const manifest = manifestResponse.json as { version?: unknown } | null;
    const version = manifest?.version;
    if (
      typeof version !== "string" ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(
        version
      )
    ) {
      throw new Error("The latest Copilot manifest has no valid version.");
    }

    const release: LatestRelease = {
      body: typeof responseRelease.body === "string" ? responseRelease.body : "",
      htmlUrl:
        typeof responseRelease.html_url === "string"
          ? responseRelease.html_url
          : "https://github.com/logancyang/obsidian-copilot/releases/latest",
      version,
    };
    return {
      version: release.version,
      error: null,
      release,
    };
  } catch (error) {
    return {
      version: null,
      error: error instanceof Error ? error.message : "Failed to check for updates",
      release: null,
    };
  }
}

export function isOSeriesModel(model: BaseChatModel | string): boolean {
  if (typeof model === "string") {
    return model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
  }

  const m = model as unknown as Record<string, unknown>;
  const modelName: string = (m.modelName as string) || (m.model as string) || "";
  return modelName.startsWith("o1") || modelName.startsWith("o3") || modelName.startsWith("o4");
}

function isGPT5Model(model: BaseChatModel | string): boolean {
  if (typeof model === "string") {
    return model.startsWith("gpt-5");
  }

  const m = model as unknown as Record<string, unknown>;
  const modelName: string = (m.modelName as string) || (m.model as string) || "";
  return modelName.startsWith("gpt-5");
}

export interface ModelInfo {
  isOSeries: boolean;
  isGPT5: boolean;
  isThinkingEnabled: boolean;
  usesAdaptiveThinking: boolean;
}

export function getModelInfo(model: BaseChatModel | string): ModelInfo {
  const m = model as unknown as Record<string, unknown>;
  const modelName: string =
    typeof model === "string" ? model : (m.modelName as string) || (m.model as string) || "";

  const isOSeries = isOSeriesModel(modelName);
  const isGPT5 = isGPT5Model(modelName);
  const isThinkingEnabled =
    modelName.startsWith("claude-3-7-sonnet") ||
    modelName.startsWith("claude-sonnet-4") ||
    modelName.startsWith("claude-opus-4");

  const opusMinorMatch = modelName.match(/^claude-opus-4-(\d{1,2})(?:[-.]|$)/);
  const usesAdaptiveThinking = opusMinorMatch ? parseInt(opusMinorMatch[1], 10) >= 7 : false;

  return {
    isOSeries,
    isGPT5,
    isThinkingEnabled,
    usesAdaptiveThinking,
  };
}

export function getMessageRole(model: BaseChatModel | string): "system" | "human" {
  return isOSeriesModel(model) ? "human" : "system";
}

export function extractTextFromChunk(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("");
  }
  return "";
}

export function removeThinkTags(text: unknown): string {
  const plainText = extractTextFromChunk(text);
  let cleanedText = plainText.replace(/<think>[\s\S]*?<\/think>/g, "");
  cleanedText = cleanedText.replace(/<think>[\s\S]*$/g, "");
  return cleanedText.trim();
}

export function removeErrorTags(text: unknown): string {
  const plainText = extractTextFromChunk(text);
  return plainText.replace(/<errorChunk>[\s\S]*?<\/errorChunk>/g, "").trim();
}

export function randomUUID() {
  return crypto.randomUUID();
}

export async function withSuppressedTokenWarnings<T>(fn: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;

  try {
    console.warn = function (...args: unknown[]) {
      const first = args[0];
      if (
        typeof first === "string" &&
        (first.includes("Failed to calculate number of tokens") || first.includes("Unknown model"))
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };

    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName: string = "Operation"
): Promise<T> {
  const { TimeoutError } = await import("@/error");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
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
    window.clearTimeout(timeoutId);
  }
}

export function isSourceModeOn(app: App): boolean {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return true;

  const state = view.getState() as { source?: boolean };
  return state.source === true;
}

export function getUtf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function truncateToByteLimit(str: string, byteLimit: number): string {
  if (byteLimit <= 0) {
    return "";
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= byteLimit) {
    return str;
  }

  let low = 0;
  let high = str.length;
  let result = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = str.substring(0, mid);
    const candidateBytes = encoder.encode(candidate);

    if (candidateBytes.length <= byteLimit) {
      result = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

const MAX_FILENAME_BYTES = 255;

export function sanitizeFilePath(filePath: string): string {
  const parts = filePath.split("/");
  const basename = parts[parts.length - 1];

  if (getUtf8ByteLength(basename) <= MAX_FILENAME_BYTES) {
    return filePath;
  }

  const extIndex = basename.lastIndexOf(".");
  const ext = extIndex >= 0 ? basename.substring(extIndex) : "";
  const name = extIndex >= 0 ? basename.substring(0, extIndex) : basename;

  const extBytes = getUtf8ByteLength(ext);
  const availableBytes = MAX_FILENAME_BYTES - extBytes;

  if (availableBytes <= 0) {
    parts[parts.length - 1] = truncateToByteLimit(basename, MAX_FILENAME_BYTES);
  } else {
    parts[parts.length - 1] = truncateToByteLimit(name, availableBytes) + ext;
  }

  return parts.join("/");
}

export async function openFileInWorkspace(app: App, file: TFile): Promise<void> {
  let existingLeaf = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (
      leaf.view.getViewType() === "markdown" ||
      leaf.view.getViewType() === "pdf" ||
      leaf.view.getViewType() === "canvas"
    ) {
      const viewFile = (leaf.view as unknown as Record<string, unknown>).file as
        | { path: string }
        | undefined;
      if (viewFile && viewFile.path === file.path) {
        existingLeaf = leaf;
      }
    }
  });

  if (existingLeaf) {
    app.workspace.setActiveLeaf(existingLeaf, { focus: true });
  } else {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
}
