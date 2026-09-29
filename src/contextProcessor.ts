import { SelectedTextContext } from "@/types/message";
import { ChainType } from "@/chainType";
import { RESTRICTION_MESSAGES } from "@/constants";
import { logWarn, logInfo, logError } from "@/logger";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { WebViewerTimeoutError } from "@/services/webViewerService/webViewerServiceTypes";
import { FileParserManager } from "@/tools/FileParserManager";
import { isPlusChain, isTextReadableFile } from "@/utils";
import { normalizeUrlString } from "@/utils/urlNormalization";
import { App, TFile, Vault, Notice } from "obsidian";
import {
  NOTE_CONTEXT_PROMPT_TAG,
  EMBEDDED_PDF_TAG,
  EMBEDDED_NOTE_TAG,
  SELECTED_TEXT_TAG,
  WEB_SELECTED_TEXT_TAG,
  DATAVIEW_BLOCK_TAG,
  WEB_TAB_CONTEXT_TAG,
  ACTIVE_WEB_TAB_CONTEXT_TAG,
  YOUTUBE_VIDEO_CONTEXT_TAG,
} from "./constants";

interface DataviewApi {
  query(
    query: string,
    sourcePath: string
  ): Promise<{ successful: boolean; error?: string; value: DataviewResult }>;
}

interface DataviewResult {
  type: string;
  values: DataviewRow[];
  headers?: string[];
}

type DataviewRow = unknown[] | DataviewTaskItem | DataviewLinkLike;

interface DataviewTaskItem {
  completed: boolean;
  text?: string;
}

interface DataviewLinkLike {
  path: string;
}

interface EmbeddedLinkTarget {
  path: string | null;
  heading?: string;
  blockId?: string;
}

interface MarkdownSegment {
  content: string;
  found: boolean;
}

export class ContextProcessor {
  private static instance: ContextProcessor;
  private app: App;

  private constructor(app: App) {
    this.app = app;
  }

  static getInstance(app?: App): ContextProcessor {
    if (!ContextProcessor.instance) {
      if (!app) {
        throw new Error(
          "ContextProcessor.getInstance() requires `app` on first call (seed it at plugin load)."
        );
      }
      ContextProcessor.instance = new ContextProcessor(app);
    }
    return ContextProcessor.instance;
  }

  async processEmbeddedPDFs(
    content: string,
    vault: Vault,
    fileParserManager: FileParserManager
  ): Promise<string> {
    const pdfRegex = /!\[\[(.*?\.pdf)\]\]/g;
    const matches = [...content.matchAll(pdfRegex)];

    for (const match of matches) {
      const pdfName = match[1];
      const pdfFile = vault.getAbstractFileByPath(pdfName);

      if (pdfFile instanceof TFile) {
        try {
          const pdfContent = await fileParserManager.parseFile(pdfFile, vault);
          content = content.replace(
            match[0],
            `\n\n<${EMBEDDED_PDF_TAG}>\n<name>${pdfName}</name>\n<content>\n${pdfContent}\n</content>\n</${EMBEDDED_PDF_TAG}>\n\n`
          );
        } catch (error) {
          logError(`Error processing embedded PDF ${pdfName}:`, error);
          content = content.replace(
            match[0],
            `\n\n<${EMBEDDED_PDF_TAG}>\n<name>${pdfName}</name>\n<error>Could not process PDF</error>\n</${EMBEDDED_PDF_TAG}>\n\n`
          );
        }
      }
    }
    return content;
  }

  async processDataviewBlocks(content: string, sourcePath: string): Promise<string> {
    const dataviewPlugin = (
      this.app as unknown as { plugins?: { plugins?: { dataview?: { api?: DataviewApi } } } }
    ).plugins?.plugins?.dataview;
    if (!dataviewPlugin) {
      return content;
    }

    const dataviewApi = dataviewPlugin.api;
    if (!dataviewApi) {
      return content;
    }

    const blockRegex = /```(dataview|dataviewjs)\s*\n([\s\S]*?)```/g;
    const matches = [...content.matchAll(blockRegex)];

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const queryType = match[1];
      const query = match[2].trim();
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;

      try {
        const result = await Promise.race([
          this.executeDataviewQuery(dataviewApi, query, queryType, sourcePath),
          new Promise((_, reject) =>
            window.setTimeout(() => reject(new Error("Query timeout")), 5000)
          ),
        ]);

        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        const replacement = `\n\n<${DATAVIEW_BLOCK_TAG}>\n<query_type>${queryType}</query_type>\n<original_query>\n${query}\n</original_query>\n<executed_result>\n${resultStr}\n</executed_result>\n</${DATAVIEW_BLOCK_TAG}>\n\n`;
        content = content.slice(0, matchStart) + replacement + content.slice(matchEnd);
      } catch (error) {
        logError(`Error executing Dataview query:`, error);
        const replacement = `\n\n<${DATAVIEW_BLOCK_TAG}>\n<query_type>${queryType}</query_type>\n<original_query>\n${query}\n</original_query>\n<error>${error instanceof Error ? error.message : "Query execution failed"}</error>\n</${DATAVIEW_BLOCK_TAG}>\n\n`;
        content = content.slice(0, matchStart) + replacement + content.slice(matchEnd);
      }
    }

    return content;
  }

  private async executeDataviewQuery(
    dataviewApi: DataviewApi,
    query: string,
    queryType: string,
    sourcePath: string
  ): Promise<string> {
    if (queryType === "dataviewjs") {
      return "[DataviewJS execution not yet supported - showing original query]";
    }

    const result = await dataviewApi.query(query, sourcePath);

    if (!result.successful) {
      throw new Error(result.error ?? "Query failed");
    }

    return this.formatDataviewResult(result.value);
  }

  private formatDataviewResult(result: DataviewResult): string {
    if (!result) {
      return "No results";
    }

    if (result.type === "list") {
      return this.formatDataviewList(result.values);
    } else if (result.type === "table") {
      return this.formatDataviewTable(result.headers ?? [], result.values as unknown[][]);
    } else if (result.type === "task") {
      return this.formatDataviewTasks(result.values as DataviewTaskItem[]);
    } else if (Array.isArray(result)) {
      return (result as unknown[]).map((item) => this.formatDataviewValue(item)).join("\n");
    }

    return JSON.stringify(result);
  }

  private formatDataviewList(values: DataviewRow[]): string {
    if (!values || values.length === 0) {
      return "No results";
    }
    return values.map((item) => `- ${this.formatDataviewValue(item)}`).join("\n");
  }

  private formatDataviewTable(headers: string[], rows: unknown[][]): string {
    if (!rows || rows.length === 0) {
      return "No results";
    }

    let table = `| ${headers.join(" | ")} |\n`;
    table += `| ${headers.map(() => "---").join(" | ")} |\n`;

    for (const row of rows) {
      table += `| ${row.map((cell) => this.formatDataviewValue(cell)).join(" | ")} |\n`;
    }

    return table;
  }

  private formatDataviewTasks(tasks: DataviewTaskItem[]): string {
    if (!tasks || tasks.length === 0) {
      return "No results";
    }
    return tasks
      .map((task) => {
        const checkbox = task.completed ? "[x]" : "[ ]";
        return `- ${checkbox} ${this.formatDataviewValue(task.text ?? task)}`;
      })
      .join("\n");
  }

  private formatDataviewValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (value && typeof value === "object" && "path" in value) {
      return `[[${(value as DataviewLinkLike).path}]]`;
    }

    if (Array.isArray(value)) {
      return (value as unknown[]).map((v) => this.formatDataviewValue(v)).join(", ");
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return `${value as string | number | boolean | bigint}`;
  }

  private async buildMarkdownContextContent(
    note: TFile,
    vault: Vault,
    fileParserManager: FileParserManager,
    chainType: ChainType
  ): Promise<string> {
    let content = await fileParserManager.parseFile(note, vault);

    content = await this.processEmbeddedNotes(content, note, vault, fileParserManager, chainType);

    if (isPlusChain(chainType)) {
      content = await this.processEmbeddedPDFs(content, vault, fileParserManager);
    }

    return await this.processDataviewBlocks(content, note.path);
  }

  private async processEmbeddedNotes(
    content: string,
    sourceNote: TFile,
    vault: Vault,
    fileParserManager: FileParserManager,
    chainType: ChainType
  ): Promise<string> {
    const embedRegex = /!\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let result = "";

    while ((match = embedRegex.exec(content)) !== null) {
      result += content.slice(lastIndex, match.index);
      const rawTarget = match[1].trim();
      const replacement = await this.buildEmbeddedNoteBlock(
        rawTarget,
        match[0],
        sourceNote,
        vault,
        fileParserManager,
        chainType
      );
      result += replacement;
      lastIndex = match.index + match[0].length;
    }

    result += content.slice(lastIndex);
    return result;
  }

  private async buildEmbeddedNoteBlock(
    rawTarget: string,
    rawMatch: string,
    sourceNote: TFile,
    vault: Vault,
    fileParserManager: FileParserManager,
    chainType: ChainType
  ): Promise<string> {
    const target = this.parseEmbeddedLinkTarget(rawTarget);
    if (!target) {
      return rawMatch;
    }

    const resolvedFile =
      target.path === null
        ? sourceNote
        : this.app.metadataCache.getFirstLinkpathDest(target.path, sourceNote.path);

    if (!(resolvedFile instanceof TFile)) {
      return this.formatEmbeddedNoteBlock({
        title: target.path ?? sourceNote.basename,
        path: target.path ?? sourceNote.path,
        heading: target.heading,
        blockId: target.blockId,
        error: "Embedded note not found",
      });
    }

    if (resolvedFile.extension !== "md") {
      return rawMatch;
    }

    try {
      let embeddedContent = await fileParserManager.parseFile(resolvedFile, vault);

      if (target.heading || target.blockId) {
        const segment = this.extractMarkdownSegment(resolvedFile, embeddedContent, target);
        if (!segment.found) {
          const targetDescription = target.blockId
            ? `block reference "${target.blockId}"`
            : `heading "${target.heading ?? ""}"`;
          throw new Error(`Embedded note ${targetDescription} not found in ${resolvedFile.path}`);
        }
        embeddedContent = segment.content;
      }

      if (isPlusChain(chainType)) {
        embeddedContent = await this.processEmbeddedPDFs(embeddedContent, vault, fileParserManager);
      }

      embeddedContent = await this.processDataviewBlocks(embeddedContent, resolvedFile.path);

      return this.formatEmbeddedNoteBlock({
        title: resolvedFile.basename,
        path: resolvedFile.path,
        heading: target.heading,
        blockId: target.blockId,
        content: embeddedContent,
      });
    } catch (error) {
      logWarn("Failed to process embedded note", error);
      const message = error instanceof Error ? error.message : "Could not process embedded note";
      return this.formatEmbeddedNoteBlock({
        title: resolvedFile.basename,
        path: resolvedFile.path,
        heading: target.heading,
        blockId: target.blockId,
        error: message,
      });
    }
  }

  private parseEmbeddedLinkTarget(rawTarget: string): EmbeddedLinkTarget | null {
    if (!rawTarget) {
      return null;
    }

    const aliasIndex = rawTarget.indexOf("|");
    const linkTarget = aliasIndex >= 0 ? rawTarget.slice(0, aliasIndex) : rawTarget;
    let cleanedTarget = linkTarget.trim();

    if (!cleanedTarget) {
      return { path: null };
    }

    let blockId: string | undefined;
    let heading: string | undefined;

    const blockIndex = cleanedTarget.indexOf("#^");
    if (blockIndex !== -1) {
      blockId = cleanedTarget.slice(blockIndex + 2).trim();
      cleanedTarget = cleanedTarget.slice(0, blockIndex);
    }

    const headingIndex = cleanedTarget.indexOf("#");
    if (headingIndex !== -1) {
      heading = cleanedTarget.slice(headingIndex + 1).trim();
      cleanedTarget = cleanedTarget.slice(0, headingIndex);
    }

    const path = cleanedTarget.length > 0 ? cleanedTarget : null;

    return {
      path,
      heading: heading && heading.length > 0 ? heading : undefined,
      blockId: blockId && blockId.length > 0 ? blockId : undefined,
    };
  }

  private extractMarkdownSegment(
    note: TFile,
    fileContent: string,
    focus: EmbeddedLinkTarget
  ): MarkdownSegment {
    const cache = this.app.metadataCache.getFileCache(note);

    if (focus.blockId) {
      const block = cache?.blocks?.[focus.blockId];
      const startOffset = block?.position?.start?.offset;
      const endOffset = block?.position?.end?.offset;

      if (startOffset === undefined || endOffset === undefined) {
        return { content: "", found: false };
      }

      return {
        content: fileContent.slice(startOffset, endOffset),
        found: true,
      };
    }

    if (focus.heading) {
      const headings = cache?.headings ?? [];
      const normalizedTarget = this.normalizeHeadingForMatch(focus.heading);
      const targetIndex = headings.findIndex(
        (headingCache) => this.normalizeHeadingForMatch(headingCache.heading) === normalizedTarget
      );

      if (targetIndex === -1) {
        return { content: "", found: false };
      }

      const currentHeading = headings[targetIndex];
      const startOffset = currentHeading.position?.start?.offset ?? 0;
      let endOffset = fileContent.length;

      for (let i = targetIndex + 1; i < headings.length; i++) {
        if (headings[i].level <= currentHeading.level) {
          endOffset = headings[i].position?.start?.offset ?? endOffset;
          break;
        }
      }

      return {
        content: fileContent.slice(startOffset, endOffset),
        found: true,
      };
    }

    return { content: fileContent, found: true };
  }

  private normalizeHeadingForMatch(heading: string): string {
    return heading.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private formatEmbeddedNoteBlock(params: {
    title: string;
    path: string;
    heading?: string;
    blockId?: string;
    content?: string;
    error?: string;
  }): string {
    const { title, path, heading, blockId, content, error } = params;
    let block = `\n\n<${EMBEDDED_NOTE_TAG}>\n<title>${title}</title>\n<path>${path}</path>`;

    if (heading) {
      block += `\n<heading>${heading}</heading>`;
    }

    if (blockId) {
      block += `\n<block_id>${blockId}</block_id>`;
    }

    if (error) {
      block += `\n<error>${error}</error>`;
    } else {
      block += `\n<content>\n${content ?? ""}\n</content>`;
    }

    block += `\n</${EMBEDDED_NOTE_TAG}>\n\n`;
    return block;
  }

  async processContextNotes(
    excludedNotePaths: Set<string>,
    fileParserManager: FileParserManager,
    vault: Vault,
    contextNotes: TFile[],
    includeActiveNote: boolean,
    activeNote: TFile | null,
    currentChain: ChainType
  ): Promise<string> {
    let additionalContext = "";

    const processNote = async (note: TFile, prompt_tag: string = NOTE_CONTEXT_PROMPT_TAG) => {
      try {
        if (excludedNotePaths.has(note.path)) {
          logInfo(`Skipping note ${note.path} as it was included via custom prompt.`);
          return;
        }

        if (!fileParserManager.supportsExtension(note.extension)) {
          logWarn(`Unsupported file type: ${note.extension}`);
          return;
        }

        if (!isPlusChain(currentChain) && !isTextReadableFile(note)) {
          logWarn(`File type ${note.extension} requires Copilot Plus mode for context processing.`);
          new Notice(RESTRICTION_MESSAGES.NON_MARKDOWN_FILES_RESTRICTED);
          return;
        }

        const content =
          note.extension === "md"
            ? await this.buildMarkdownContextContent(note, vault, fileParserManager, currentChain)
            : await fileParserManager.parseFile(note, vault);

        const stats = await vault.adapter.stat(note.path);
        const ctime = stats ? new Date(stats.ctime).toISOString() : "Unknown";
        const mtime = stats ? new Date(stats.mtime).toISOString() : "Unknown";

        additionalContext += `\n\n<${prompt_tag}>\n<title>${escapeXml(note.basename)}</title>\n<path>${note.path}</path>\n<ctime>${ctime}</ctime>\n<mtime>${mtime}</mtime>\n<content>\n${content}\n</content>\n</${prompt_tag}>`;
      } catch (error) {
        logError(`Error processing file ${note.path}:`, error);
        additionalContext += `\n\n<${prompt_tag}_error>\n<title>${escapeXml(note.basename)}</title>\n<path>${note.path}</path>\n<error>[Error: Could not process file]</error>\n</${prompt_tag}_error>`;
      }
    };

    const includedFilePaths = new Set<string>();

    if (includeActiveNote && activeNote) {
      await processNote(activeNote, "active_note");
      includedFilePaths.add(activeNote.path);
    }

    for (const note of contextNotes) {
      if (includedFilePaths.has(note.path)) {
        continue;
      }
      await processNote(note);
      includedFilePaths.add(note.path);
    }

    return additionalContext;
  }

  processSelectedTextContexts(
    selectedTextContexts: readonly SelectedTextContext[] | undefined
  ): string {
    if (!selectedTextContexts || selectedTextContexts.length === 0) {
      return "";
    }

    let additionalContext = "";

    for (const selectedText of selectedTextContexts) {
      if (selectedText.sourceType === "web") {
        additionalContext += `\n\n<${WEB_SELECTED_TEXT_TAG}>\n<title>${escapeXml(selectedText.title)}</title>\n<url>${escapeXml(selectedText.url)}</url>\n<content>\n${escapeXml(selectedText.content)}\n</content>\n</${WEB_SELECTED_TEXT_TAG}>`;
      } else {
        const lineTags =
          selectedText.startLine > 0
            ? `\n<start_line>${selectedText.startLine}</start_line>\n<end_line>${selectedText.endLine}</end_line>`
            : "";
        additionalContext += `\n\n<${SELECTED_TEXT_TAG}>\n<title>${escapeXml(selectedText.noteTitle)}</title>\n<path>${escapeXml(selectedText.notePath)}</path>${lineTags}\n<content>\n${selectedText.content}\n</content>\n</${SELECTED_TEXT_TAG}>`;
      }
    }

    return additionalContext;
  }

  async processContextWebTabs(
    webTabs: Array<{ url: string; title?: string; faviconUrl?: string; isActive?: boolean }>
  ): Promise<string> {
    if (!webTabs || webTabs.length === 0) {
      return "";
    }

    const WEBVIEW_READY_TIMEOUT_MS = 2_500;
    const READER_MODE_CONTENT_TIMEOUT_MS = 8_000;
    const YOUTUBE_TRANSCRIPT_TIMEOUT_MS = 15_000;
    const MAX_CONCURRENCY = 2;

    const buildWebTabBlock = (
      tagName: string,
      options: {
        title: string;
        url: string;
        mode?: string;
        content?: string;
        error?: string;
      }
    ): string => {
      const parts = [
        `\n\n<${tagName}>`,
        `\n<title>${escapeXml(options.title)}</title>`,
        `\n<url>${escapeXml(options.url)}</url>`,
      ];

      if (options.mode) {
        parts.push(`\n<mode>${escapeXml(options.mode)}</mode>`);
      }

      if (options.error) {
        parts.push(`\n<error>${escapeXml(options.error)}</error>`);
      } else if (options.content !== undefined) {
        parts.push(`\n<content>\n${escapeXml(options.content)}\n</content>`);
      }

      parts.push(`\n</${tagName}>`);
      return parts.join("");
    };

    const buildYouTubeBlock = (options: {
      title: string;
      url: string;
      videoId: string;
      channel?: string;
      description?: string;
      uploadDate?: string;
      duration?: string;
      genre?: string;
      transcript?: string;
      error?: string;
      isActive?: boolean;
    }): string => {
      const parts = [
        `\n\n<${YOUTUBE_VIDEO_CONTEXT_TAG}>`,
        `\n<title>${escapeXml(options.title)}</title>`,
        `\n<url>${escapeXml(options.url)}</url>`,
        `\n<video_id>${escapeXml(options.videoId)}</video_id>`,
      ];

      if (options.isActive) {
        parts.push(`\n<is_active>true</is_active>`);
      }

      if (options.channel) {
        parts.push(`\n<channel>${escapeXml(options.channel)}</channel>`);
      }

      if (options.uploadDate) {
        parts.push(`\n<upload_date>${escapeXml(options.uploadDate)}</upload_date>`);
      }

      if (options.duration) {
        parts.push(`\n<duration>${escapeXml(options.duration)}</duration>`);
      }

      if (options.genre) {
        parts.push(`\n<genre>${escapeXml(options.genre)}</genre>`);
      }

      if (options.description) {
        parts.push(`\n<description>${escapeXml(options.description)}</description>`);
      }

      if (options.error) {
        parts.push(`\n<error>${escapeXml(options.error)}</error>`);
      }

      const content = options.transcript || "No transcript available for this video";
      parts.push(`\n<content>\n${escapeXml(content)}\n</content>`);

      parts.push(`\n</${YOUTUBE_VIDEO_CONTEXT_TAG}>`);
      return parts.join("");
    };

    let activeTab: { url: string; title?: string; faviconUrl?: string } | null = null;
    const normalTabs: Array<{ url: string; title?: string; faviconUrl?: string }> = [];
    const seenUrls = new Set<string>();
    const seenVideoIds = new Set<string>();
    const service = getWebViewerService(this.app);

    const isDuplicate = (url: string): boolean => {
      const videoId = service.getYouTubeVideoId(url);
      if (videoId) {
        if (seenVideoIds.has(videoId)) return true;
        seenVideoIds.add(videoId);
        return false;
      }
      if (seenUrls.has(url)) return true;
      seenUrls.add(url);
      return false;
    };

    for (const tab of webTabs) {
      const url = normalizeUrlString(tab.url);
      if (!url) continue;

      if (tab.isActive && !activeTab) {
        activeTab = { ...tab, url };
        isDuplicate(url);
      }
    }

    for (const tab of webTabs) {
      const url = normalizeUrlString(tab.url);
      if (!url || isDuplicate(url)) continue;

      normalTabs.push({ ...tab, url });
    }

    if (!activeTab && normalTabs.length === 0) {
      return "";
    }

    const availability = service.getAvailability();
    if (!availability.supported || !availability.available) {
      const reason =
        availability.reason ??
        (availability.supported
          ? "Web Viewer is not available."
          : "Web Viewer is not supported on this platform.");

      const blocks: string[] = [];
      if (activeTab) {
        blocks.push(
          buildWebTabBlock(ACTIVE_WEB_TAB_CONTEXT_TAG, {
            title: activeTab.title || "Unknown",
            url: activeTab.url,
            error: reason,
          })
        );
      }
      for (const tab of normalTabs) {
        blocks.push(
          buildWebTabBlock(WEB_TAB_CONTEXT_TAG, {
            title: tab.title || "Unknown",
            url: tab.url,
            error: reason,
          })
        );
      }
      return blocks.join("");
    }

    const processTab = async (
      tab: { url: string; title?: string; faviconUrl?: string },
      tagName: string
    ): Promise<string> => {
      try {
        const url = tab.url;

        const videoId = service.getYouTubeVideoId(url);
        if (videoId) {
          const isActive = tagName === ACTIVE_WEB_TAB_CONTEXT_TAG;
          return await processYouTubeTab(tab, videoId, isActive);
        }

        const leaf = service.findLeafByUrl(url, { title: tab.title });
        if (!leaf) {
          return buildWebTabBlock(tagName, {
            title: tab.title || "Unknown",
            url,
            error: "Web tab not found or closed",
          });
        }

        let pageInfo = service.getPageInfo(leaf);

        const view = leaf.view as { webviewMounted?: boolean; webviewFirstLoadFinished?: boolean };
        const webviewReady =
          view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined
            ? true
            : Boolean(view.webviewMounted && view.webviewFirstLoadFinished);
        if (!webviewReady) {
          try {
            await service.waitForWebviewReady(leaf, WEBVIEW_READY_TIMEOUT_MS);
            pageInfo = service.getPageInfo(leaf);
          } catch (err) {
            logWarn(`Web tab content not loaded yet for ${url}:`, err);
            return buildWebTabBlock(tagName, {
              title: pageInfo.title || tab.title || "Untitled",
              url: pageInfo.url || url,
              mode: pageInfo.mode,
              error: "Web tab content not loaded yet",
            });
          }
        }

        const abortController = new AbortController();
        const timeoutId = window.setTimeout(() => {
          abortController.abort();
        }, READER_MODE_CONTENT_TIMEOUT_MS);

        try {
          const content = await service.getReaderModeMarkdown(leaf, {
            signal: abortController.signal,
          });
          pageInfo = service.getPageInfo(leaf);

          return buildWebTabBlock(tagName, {
            title: pageInfo.title || tab.title || "Untitled",
            url: pageInfo.url || url,
            mode: pageInfo.mode,
            content,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (error) {
        logError(`Error processing web tab ${tab.url}:`, error);
        return buildWebTabBlock(tagName, {
          title: tab.title || "Unknown",
          url: tab.url,
          error:
            error instanceof WebViewerTimeoutError
              ? "Web tab content extraction timed out"
              : "Could not process web tab",
        });
      }
    };

    const processYouTubeTab = async (
      tab: { url: string; title?: string; faviconUrl?: string },
      videoId: string,
      isActive: boolean
    ): Promise<string> => {
      try {
        let leaf = null;
        let actualUrl = tab.url;

        for (const l of service.getLeaves()) {
          const leafUrl = service.getPageInfo(l).url;
          if (service.getYouTubeVideoId(leafUrl) === videoId) {
            leaf = l;
            actualUrl = leafUrl;
            break;
          }
        }

        if (!leaf) {
          return buildYouTubeBlock({
            title: tab.title || "YouTube Video",
            url: tab.url,
            videoId,
            isActive,
            error: "Web tab not found or closed",
          });
        }

        const view = leaf.view as { webviewMounted?: boolean; webviewFirstLoadFinished?: boolean };
        const webviewReady =
          view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined
            ? true
            : Boolean(view.webviewMounted && view.webviewFirstLoadFinished);
        if (!webviewReady) {
          try {
            await service.waitForWebviewReady(leaf, WEBVIEW_READY_TIMEOUT_MS);
          } catch (err) {
            logWarn(`YouTube tab content not loaded yet for ${actualUrl}:`, err);
            return buildYouTubeBlock({
              title: tab.title || "YouTube Video",
              url: actualUrl,
              videoId,
              isActive,
              error: "Web tab content not loaded yet",
            });
          }
        }

        const result = await service.getYouTubeTranscript(leaf, {
          timeoutMs: YOUTUBE_TRANSCRIPT_TIMEOUT_MS,
        });

        const transcriptText =
          result.transcript.length > 0
            ? result.transcript.map((seg) => `${seg.timestamp}: ${seg.text}`).join("\n")
            : undefined;

        return buildYouTubeBlock({
          title: result.title || tab.title || "YouTube Video",
          url: actualUrl,
          videoId: result.videoId,
          channel: result.channel,
          description: result.description,
          uploadDate: result.uploadDate,
          duration: result.duration,
          genre: result.genre,
          transcript: transcriptText,
          isActive,
        });
      } catch (err) {
        logWarn(`YouTube transcript extraction failed for ${tab.url}:`, err);

        return buildYouTubeBlock({
          title: tab.title || "YouTube Video",
          url: tab.url,
          videoId,
          isActive,
          error: err instanceof Error ? err.message : "Failed to extract video info",
        });
      }
    };

    const blocks: string[] = [];
    if (activeTab) {
      const activeBlock = await processTab(activeTab, ACTIVE_WEB_TAB_CONTEXT_TAG);
      blocks.push(activeBlock);
    }

    for (let i = 0; i < normalTabs.length; i += MAX_CONCURRENCY) {
      const chunk = normalTabs.slice(i, i + MAX_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map((tab) => processTab(tab, WEB_TAB_CONTEXT_TAG))
      );
      blocks.push(...chunkResults);
    }

    return blocks.join("");
  }
}
