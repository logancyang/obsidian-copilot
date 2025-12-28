import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { RESTRICTION_MESSAGES } from "@/constants";
import { logWarn, logInfo, logError } from "@/logger";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { WebViewerTimeoutError } from "@/services/webViewerService/webViewerServiceTypes";
import { FileParserManager } from "@/tools/FileParserManager";
import { isPlusChain } from "@/utils";
import { normalizeUrlString } from "@/utils/urlNormalization";
import { TFile, Vault, Notice } from "obsidian";
import {
  NOTE_CONTEXT_PROMPT_TAG,
  EMBEDDED_PDF_TAG,
  EMBEDDED_NOTE_TAG,
  SELECTED_TEXT_TAG,
  WEB_SELECTED_TEXT_TAG,
  DATAVIEW_BLOCK_TAG,
  WEB_TAB_CONTEXT_TAG,
  ACTIVE_WEB_TAB_CONTEXT_TAG,
} from "./constants";

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

  private constructor() {}

  static getInstance(): ContextProcessor {
    if (!ContextProcessor.instance) {
      ContextProcessor.instance = new ContextProcessor();
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

  /**
   * Process Dataview blocks in content, executing queries and replacing them with structured results
   */
  async processDataviewBlocks(content: string, sourcePath: string): Promise<string> {
    // Check if Dataview plugin is available
    const dataviewPlugin = (app as any).plugins?.plugins?.dataview;
    if (!dataviewPlugin) {
      return content; // Dataview not installed, return content as-is
    }

    const dataviewApi = dataviewPlugin.api;
    if (!dataviewApi) {
      return content; // API not available
    }

    // Match dataview and dataviewjs code blocks
    // Fixed regex: \s* handles trailing spaces and different line endings
    const blockRegex = /```(dataview|dataviewjs)\s*\n([\s\S]*?)```/g;
    const matches = [...content.matchAll(blockRegex)];

    // Process matches in reverse order to avoid position shifts when replacing
    // This also handles multiple identical blocks correctly
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const queryType = match[1]; // 'dataview' or 'dataviewjs'
      const query = match[2].trim();
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;

      try {
        // Execute query with timeout
        const result = await Promise.race([
          this.executeDataviewQuery(dataviewApi, query, queryType, sourcePath),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout")), 5000)),
        ]);

        // Replace block with structured output using slice (position-based, handles duplicates)
        const replacement = `\n\n<${DATAVIEW_BLOCK_TAG}>\n<query_type>${queryType}</query_type>\n<original_query>\n${query}\n</original_query>\n<executed_result>\n${result}\n</executed_result>\n</${DATAVIEW_BLOCK_TAG}>\n\n`;
        content = content.slice(0, matchStart) + replacement + content.slice(matchEnd);
      } catch (error) {
        logError(`Error executing Dataview query:`, error);
        // On error, include query with error message
        const replacement = `\n\n<${DATAVIEW_BLOCK_TAG}>\n<query_type>${queryType}</query_type>\n<original_query>\n${query}\n</original_query>\n<error>${error instanceof Error ? error.message : "Query execution failed"}</error>\n</${DATAVIEW_BLOCK_TAG}>\n\n`;
        content = content.slice(0, matchStart) + replacement + content.slice(matchEnd);
      }
    }

    return content;
  }

  /**
   * Execute a Dataview query and format the results
   */
  private async executeDataviewQuery(
    dataviewApi: any,
    query: string,
    queryType: string,
    sourcePath: string
  ): Promise<string> {
    if (queryType === "dataviewjs") {
      // DataviewJS requires more complex handling - for now, return a message
      return "[DataviewJS execution not yet supported - showing original query]";
    }

    // Parse and execute DQL query
    const result = await dataviewApi.query(query, sourcePath);

    if (!result.successful) {
      throw new Error(result.error || "Query failed");
    }

    // Format results based on type
    return this.formatDataviewResult(result.value);
  }

  /**
   * Format Dataview query results into readable text
   */
  private formatDataviewResult(result: any): string {
    if (!result) {
      return "No results";
    }

    // Handle different result types
    if (result.type === "list") {
      return this.formatDataviewList(result.values);
    } else if (result.type === "table") {
      return this.formatDataviewTable(result.headers, result.values);
    } else if (result.type === "task") {
      return this.formatDataviewTasks(result.values);
    } else if (Array.isArray(result)) {
      return result.map((item) => this.formatDataviewValue(item)).join("\n");
    }

    return String(result);
  }

  /**
   * Format Dataview list results
   */
  private formatDataviewList(values: any[]): string {
    if (!values || values.length === 0) {
      return "No results";
    }
    return values.map((item) => `- ${this.formatDataviewValue(item)}`).join("\n");
  }

  /**
   * Format Dataview table results
   */
  private formatDataviewTable(headers: string[], rows: any[][]): string {
    if (!rows || rows.length === 0) {
      return "No results";
    }

    // Create markdown table
    let table = `| ${headers.join(" | ")} |\n`;
    table += `| ${headers.map(() => "---").join(" | ")} |\n`;

    for (const row of rows) {
      table += `| ${row.map((cell) => this.formatDataviewValue(cell)).join(" | ")} |\n`;
    }

    return table;
  }

  /**
   * Format Dataview task results
   */
  private formatDataviewTasks(tasks: any[]): string {
    if (!tasks || tasks.length === 0) {
      return "No results";
    }
    return tasks
      .map((task) => {
        const checkbox = task.completed ? "[x]" : "[ ]";
        return `- ${checkbox} ${this.formatDataviewValue(task.text || task)}`;
      })
      .join("\n");
  }

  /**
   * Format individual Dataview values
   */
  private formatDataviewValue(value: any): string {
    if (value === null || value === undefined) {
      return "";
    }

    // Handle links
    if (value && typeof value === "object" && value.path) {
      return `[[${value.path}]]`;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((v) => this.formatDataviewValue(v)).join(", ");
    }

    return String(value);
  }

  /**
   * Build markdown content for context inclusion by resolving embeds, PDFs, and Dataview blocks.
   */
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

  /**
   * Replace embedded note syntax within markdown content.
   *
   * Scans the content for all `![[...]]` embed patterns and expands them once
   * into structured `<embedded_note>` blocks. Nested embeds are left as-is to
   * keep processing predictable and lightweight.
   *
   * @param content - The markdown content to process
   * @param sourceNote - The note containing this content (for relative link resolution)
   * @param vault - Obsidian vault instance
   * @param fileParserManager - Manager for parsing different file types
   * @param chainType - Current chain type (affects feature availability)
   * @returns Content with top-level embeds replaced by structured blocks
   */
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

  /**
   * Build a rendered embedded note block for the given target.
   */
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
        : app.metadataCache.getFirstLinkpathDest(target.path, sourceNote.path);

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

  /**
   * Parse embedded note syntax into a structured target.
   */
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

  /**
   * Extract a markdown segment representing a heading section or block reference.
   */
  private extractMarkdownSegment(
    note: TFile,
    fileContent: string,
    focus: EmbeddedLinkTarget
  ): MarkdownSegment {
    const cache = app.metadataCache.getFileCache(note);

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

  /**
   * Normalize heading text for comparison.
   */
  private normalizeHeadingForMatch(heading: string): string {
    return heading.trim().toLowerCase().replace(/\s+/g, " ");
  }

  /**
   * Format an embedded note payload using the shared XML-like structure.
   */
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

  /**
   * Processes context notes, excluding any already handled by custom prompts.
   *
   * NOTE: This method reads and includes note content as-is. URLs within note content
   * are NOT extracted or processed with url4llm. Only URLs directly typed in the user's
   * chat input are processed, not URLs that happen to be in the content of context notes.
   *
   * @param excludedNotePaths A set of file paths that should be skipped.
   * @param fileParserManager
   * @param vault
   * @param contextNotes
   * @param includeActiveNote
   * @param activeNote
   * @param currentChain
   * @returns The combined content string of the processed context notes.
   */
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
        // Check if this note was already processed (via custom prompt)
        if (excludedNotePaths.has(note.path)) {
          logInfo(`Skipping note ${note.path} as it was included via custom prompt.`);
          return;
        }

        logInfo(
          `Processing note: ${note.path}, extension: ${note.extension}, chain: ${currentChain}`
        );

        // 1. Check if the file extension is supported by any parser
        if (!fileParserManager.supportsExtension(note.extension)) {
          logWarn(`Unsupported file type: ${note.extension}`);
          return;
        }

        // 2. Apply chain restrictions only to supported files that are NOT md or canvas
        if (!isPlusChain(currentChain) && note.extension !== "md" && note.extension !== "canvas") {
          // This file type is supported, but requires Plus mode (e.g., PDF)
          logWarn(`File type ${note.extension} requires Copilot Plus mode for context processing.`);
          // Show user-facing notice about the restriction
          new Notice(RESTRICTION_MESSAGES.NON_MARKDOWN_FILES_RESTRICTED);
          return;
        }

        // 3. If we reach here, parse the file (md, canvas, or other supported type in Plus mode)
        const content =
          note.extension === "md"
            ? await this.buildMarkdownContextContent(note, vault, fileParserManager, currentChain)
            : await fileParserManager.parseFile(note, vault);

        // Get file metadata
        const stats = await vault.adapter.stat(note.path);
        const ctime = stats ? new Date(stats.ctime).toISOString() : "Unknown";
        const mtime = stats ? new Date(stats.mtime).toISOString() : "Unknown";

        additionalContext += `\n\n<${prompt_tag}>\n<title>${note.basename}</title>\n<path>${note.path}</path>\n<ctime>${ctime}</ctime>\n<mtime>${mtime}</mtime>\n<content>\n${content}\n</content>\n</${prompt_tag}>`;
      } catch (error) {
        logError(`Error processing file ${note.path}:`, error);
        additionalContext += `\n\n<${prompt_tag}_error>\n<title>${note.basename}</title>\n<path>${note.path}</path>\n<error>[Error: Could not process file]</error>\n</${prompt_tag}_error>`;
      }
    };

    const includedFilePaths = new Set<string>();

    // Process active note if included
    if (includeActiveNote && activeNote) {
      await processNote(activeNote, "active_note");
      includedFilePaths.add(activeNote.path);
    }

    // Process context notes
    for (const note of contextNotes) {
      if (includedFilePaths.has(note.path)) {
        continue;
      }
      await processNote(note);
      includedFilePaths.add(note.path);
    }

    return additionalContext;
  }

  async hasEmbeddedPDFs(content: string): Promise<boolean> {
    const pdfRegex = /!\[\[(.*?\.pdf)\]\]/g;
    return pdfRegex.test(content);
  }

  async addNoteToContext(
    note: TFile,
    vault: Vault,
    contextNotes: TFile[],
    activeNote: TFile | null,
    setContextNotes: (notes: TFile[] | ((prev: TFile[]) => TFile[])) => void,
    setIncludeActiveNote: (include: boolean) => void
  ): Promise<void> {
    // Only check if the note exists in contextNotes
    if (contextNotes.some((existing) => existing.path === note.path)) {
      return; // Note already exists in context
    }

    // Read the note content
    const content = await vault.read(note);
    const hasEmbeddedPDFs = await this.hasEmbeddedPDFs(content);

    // Set includeActiveNote if it's the active note
    if (activeNote && note.path === activeNote.path) {
      setIncludeActiveNote(true);
    }

    // Add to contextNotes with wasAddedViaReference flag
    setContextNotes((prev: TFile[]) => [
      ...prev,
      Object.assign(note, {
        wasAddedViaReference: true,
        hasEmbeddedPDFs,
      }),
    ]);
  }

  processSelectedTextContexts(): string {
    const selectedTextContexts = getSelectedTextContexts();

    if (!selectedTextContexts || selectedTextContexts.length === 0) {
      return "";
    }

    let additionalContext = "";

    for (const selectedText of selectedTextContexts) {
      if (selectedText.sourceType === "web") {
        // Web selected text context
        additionalContext += `\n\n<${WEB_SELECTED_TEXT_TAG}>\n<title>${escapeXml(selectedText.title)}</title>\n<url>${escapeXml(selectedText.url)}</url>\n<content>\n${selectedText.content}\n</content>\n</${WEB_SELECTED_TEXT_TAG}>`;
      } else {
        // Note selected text context (default for backward compatibility)
        additionalContext += `\n\n<${SELECTED_TEXT_TAG}>\n<title>${escapeXml(selectedText.noteTitle)}</title>\n<path>${escapeXml(selectedText.notePath)}</path>\n<start_line>${selectedText.startLine.toString()}</start_line>\n<end_line>${selectedText.endLine.toString()}</end_line>\n<content>\n${selectedText.content}\n</content>\n</${SELECTED_TEXT_TAG}>`;
      }
    }

    return additionalContext;
  }

  /**
   * Process web tab contexts and return formatted content for LLM.
   * Uses WebViewerService to fetch reader mode markdown from each tab.
   * Handles cases where webview content is not yet loaded (e.g., after Obsidian restart).
   *
   * Performance optimizations:
   * - Deduplicates tabs by URL
   * - Uses bounded concurrency to avoid UI blocking and resource exhaustion
   *
   * Design notes (potential future enhancements):
   * - Tab count limit: Currently no limit on number of tabs. Could add MAX_WEB_TABS similar to
   *   how activeNote is handled (single note vs multiple). For now, users self-limit by only
   *   adding tabs they need.
   * - Content length limit: Currently no truncation of long pages. Could add MAX_CHARS_PER_TAB
   *   similar to how large notes are handled. For now, reader mode already strips most bloat.
   * - Total context budget: Could implement a shared budget across all tabs. For now, the LLM's
   *   context window and token costs naturally discourage excessive context.
   */
  async processContextWebTabs(
    webTabs: Array<{ url: string; title?: string; faviconUrl?: string; isActive?: boolean }>
  ): Promise<string> {
    if (!webTabs || webTabs.length === 0) {
      return "";
    }

    const WEBVIEW_READY_TIMEOUT_MS = 2_500;
    // Timeout for reader mode content extraction to avoid hanging the message send
    const READER_MODE_CONTENT_TIMEOUT_MS = 8_000;
    // Limit concurrent webview operations to avoid UI blocking and IPC congestion
    const MAX_CONCURRENCY = 2;

    /**
     * Build a web tab context XML block.
     * Centralizes XML generation to avoid duplication and ensure consistent escaping.
     * @param tagName - The XML tag name to use (active_web_tab or web_tab_context)
     */
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
        // Content is markdown, don't escape it
        parts.push(`\n<content>\n${options.content}\n</content>`);
      }

      parts.push(`\n</${tagName}>`);
      return parts.join("");
    };

    // Separate active tab from normal tabs and deduplicate by URL
    let activeTab: { url: string; title?: string; faviconUrl?: string } | null = null;
    const normalTabs: Array<{ url: string; title?: string; faviconUrl?: string }> = [];
    const seenUrls = new Set<string>();

    // First pass: find active tab
    for (const tab of webTabs) {
      const url = normalizeUrlString(tab.url);
      if (!url) continue;

      if (tab.isActive && !activeTab) {
        activeTab = { ...tab, url };
        seenUrls.add(url);
      }
    }

    // Second pass: collect normal tabs (excluding active tab's URL)
    for (const tab of webTabs) {
      const url = normalizeUrlString(tab.url);
      if (!url || seenUrls.has(url)) continue;

      seenUrls.add(url);
      normalTabs.push({ ...tab, url });
    }

    // Check if we have any tabs to process
    if (!activeTab && normalTabs.length === 0) {
      return "";
    }

    const service = getWebViewerService(app);

    // Check Web Viewer availability first
    const availability = service.getAvailability();
    if (!availability.supported || !availability.available) {
      const reason =
        availability.reason ??
        (availability.supported ? "Web Viewer is not available." : "Web Viewer is not supported on this platform.");

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

    /**
     * Process a single tab and return its XML block.
     */
    const processTab = async (
      tab: { url: string; title?: string; faviconUrl?: string },
      tagName: string
    ): Promise<string> => {
      try {
        const url = tab.url;

        const leaf = service.findLeafByUrl(url, { title: tab.title });
        if (!leaf) {
          return buildWebTabBlock(tagName, {
            title: tab.title || "Unknown",
            url,
            error: "Web tab not found or closed",
          });
        }

        // Get initial page info (available even if webview not ready)
        let pageInfo = service.getPageInfo(leaf);

        // Check if webview is ready (content loaded)
        // Note: webviewMounted/webviewFirstLoadFinished are internal Obsidian fields
        // If they don't exist (undefined), assume ready (fallback for older versions)
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

        // Use AbortSignal for cancellable timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
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
          clearTimeout(timeoutId);
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

    // Process active tab first (if exists)
    const blocks: string[] = [];
    if (activeTab) {
      const activeBlock = await processTab(activeTab, ACTIVE_WEB_TAB_CONTEXT_TAG);
      blocks.push(activeBlock);
    }

    // Process normal tabs with bounded concurrency
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
