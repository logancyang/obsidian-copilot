import { logInfo } from "@/logger";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CompactionResult, ParsedContextItem } from "@/types/compaction";
import { HumanMessage } from "@langchain/core/messages";

/**
 * ContextCompactor - Compresses large context using map-reduce summarization.
 *
 * ## How It Works
 *
 * When context attached to a user message exceeds a configurable threshold (in tokens),
 * this class automatically compresses it using a map-reduce pattern:
 *
 * ### 1. PARSE Phase
 * The XML-structured context is parsed into discrete items. Each context block
 * (note_context, active_note, url_content, etc.) becomes a separate item with:
 * - type: The XML tag name
 * - path: File path or URL
 * - title: Note/page title
 * - content: The actual text content
 * - metadata: Additional info (ctime, mtime)
 *
 * ### 2. MAP Phase (Parallel Summarization)
 * Large items (>50k chars) are sent to the LLM for summarization in parallel.
 * - Uses low temperature (0.1) for deterministic output
 * - Max 3 concurrent requests to avoid API overload
 * - Failed summarizations keep original content
 * - If >50% fail, compaction aborts entirely (fail-safe)
 *
 * ### 3. REDUCE Phase (Rebuild)
 * Summarized items are recombined into the original XML structure.
 * - Preserves all metadata (title, path, timestamps)
 * - Marks summarized content with [SUMMARIZED] prefix
 * - Maintains item order for consistent citations
 *
 * ## Configuration
 *
 * The threshold is set in Settings > QA > Auto-Compact Threshold (in tokens).
 * Internally converted to chars using 4 chars/token estimate.
 * Set to 0 to disable auto-compaction.
 *
 * ## Example
 *
 * Before (500k chars):
 * ```xml
 * <note_context>
 *   <title>Research Notes</title>
 *   <path>notes/research.md</path>
 *   <content>[... 50,000 chars of content ...]</content>
 * </note_context>
 * ```
 *
 * After (~5k chars):
 * ```xml
 * <note_context>
 *   <title>Research Notes</title>
 *   <path>notes/research.md</path>
 *   <content>[SUMMARIZED]
 *   Key findings: ... (concise summary preserving main ideas)
 *   </content>
 * </note_context>
 * ```
 */
export class ContextCompactor {
  private static instance: ContextCompactor;
  private chatModelManager: ChatModelManager;

  /** Minimum chars to consider an item for summarization */
  private readonly MIN_ITEM_SIZE = 50000;
  /** Max parallel LLM calls */
  private readonly MAX_CONCURRENCY = 3;
  /** Low temperature for deterministic summaries */
  private readonly TEMPERATURE = 0.1;
  /** Max chars per item before truncation */
  private readonly MAX_ITEM_SIZE = 500000;

  /** XML block types to parse */
  private readonly BLOCK_TYPES = [
    "note_context",
    "active_note",
    "url_content",
    "selected_text",
    "embedded_note",
    "embedded_pdf",
    "web_tab_context",
    "active_web_tab",
    "youtube_video_context",
  ];

  private readonly PROMPT = `Summarize the following content, preserving:
- Key concepts and main ideas
- Important facts, names, and dates
- Technical details relevant for Q&A

Keep the summary concise but information-dense. Output only the summary.

Title: {title}
Path: {path}

Content:
{content}

Summary:`;

  private constructor() {
    this.chatModelManager = ChatModelManager.getInstance();
  }

  static getInstance(): ContextCompactor {
    if (!ContextCompactor.instance) {
      ContextCompactor.instance = new ContextCompactor();
    }
    return ContextCompactor.instance;
  }

  /**
   * Compact context using map-reduce summarization.
   */
  async compact(content: string): Promise<CompactionResult> {
    const originalCharCount = content.length;
    logInfo(`[ContextCompactor] Starting compaction of ${originalCharCount} chars`);

    // Parse XML into items
    const items = this.parseItems(content);
    if (items.length === 0) {
      return this.noOpResult(content);
    }

    // Map: summarize large items
    const summaries = await this.summarizeItems(items);
    if (summaries.size === 0) {
      return this.noOpResult(content);
    }

    // Reduce: rebuild with summaries
    const compacted = this.rebuild(content, items, summaries);

    logInfo(
      `[ContextCompactor] Done: ${originalCharCount} -> ${compacted.length} chars ` +
        `(${((1 - compacted.length / originalCharCount) * 100).toFixed(0)}% reduction)`
    );

    return {
      content: compacted,
      wasCompacted: true,
      originalCharCount,
      compactedCharCount: compacted.length,
      itemsProcessed: items.length,
      itemsSummarized: summaries.size,
    };
  }

  /**
   * Creates a no-op compaction result when no compaction was performed.
   * @param content - The original content that was not compacted
   * @returns A CompactionResult indicating no changes were made
   */
  private noOpResult(content: string): CompactionResult {
    return {
      content,
      wasCompacted: false,
      originalCharCount: content.length,
      compactedCharCount: content.length,
      itemsProcessed: 0,
      itemsSummarized: 0,
    };
  }

  /**
   * Parse XML content into discrete items.
   * Filters out nested blocks to avoid overlapping replacements.
   */
  private parseItems(content: string): ParsedContextItem[] {
    const items: ParsedContextItem[] = [];

    for (const type of this.BLOCK_TYPES) {
      const regex = new RegExp(`<${type}>[\\s\\S]*?<\\/${type}>`, "g");
      let match;
      while ((match = regex.exec(content)) !== null) {
        const item = this.parseBlock(match[0], type, match.index);
        if (item) items.push(item);
      }
    }

    // Sort by start index
    items.sort((a, b) => a.startIndex - b.startIndex);

    // Filter out nested items (fully contained within another item)
    // This prevents overlapping replacements that corrupt indices
    return items.filter(
      (item, i) =>
        !items.some(
          (other, j) =>
            i !== j && other.startIndex <= item.startIndex && other.endIndex >= item.endIndex
        )
    );
  }

  /**
   * Parses a single XML block into a ParsedContextItem.
   * @param block - The raw XML block string
   * @param type - The type of context block (e.g., 'note_context', 'active_note')
   * @param startIndex - The character index where this block starts in the original content
   * @returns A ParsedContextItem or null if parsing fails
   */
  private parseBlock(block: string, type: string, startIndex: number): ParsedContextItem | null {
    const extract = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)?.[1] || "";
    const extractContent = () => /<content>([\s\S]*?)<\/content>/.exec(block)?.[1] || "";

    const path = extract("path") || extract("url");
    const title = extract("title") || path.split("/").pop() || "Untitled";
    const innerContent = extractContent();

    return {
      type,
      path,
      title,
      content: innerContent,
      metadata: { ctime: extract("ctime"), mtime: extract("mtime") },
      originalXml: block,
      startIndex,
      endIndex: startIndex + block.length,
    };
  }

  /**
   * Map phase: summarize large items in parallel batches.
   */
  private async summarizeItems(items: ParsedContextItem[]): Promise<Map<number, string>> {
    const summaries = new Map<number, string>();

    // Filter items needing summarization
    const toProcess = items
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => item.content.length >= this.MIN_ITEM_SIZE);

    if (toProcess.length === 0) return summaries;

    logInfo(`[ContextCompactor] Summarizing ${toProcess.length} items`);

    // Process in batches
    for (let i = 0; i < toProcess.length; i += this.MAX_CONCURRENCY) {
      const batch = toProcess.slice(i, i + this.MAX_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ({ index, item }) => {
          try {
            return { index, summary: await this.summarize(item) };
          } catch (e) {
            logInfo(`[ContextCompactor] Failed to summarize item ${index}:`, e);
            return { index, summary: null };
          }
        })
      );
      results.forEach(({ index, summary }) => {
        if (summary) summaries.set(index, summary);
      });
    }

    // Abort if too many failures
    if (summaries.size < toProcess.length * 0.5) {
      logInfo(`[ContextCompactor] High failure rate, aborting compaction`);
      return new Map();
    }

    return summaries;
  }

  /**
   * Summarizes a single context item using the LLM.
   * @param item - The parsed context item to summarize
   * @returns The summarized content string
   */
  private async summarize(item: ParsedContextItem): Promise<string> {
    let content = item.content;
    if (content.length > this.MAX_ITEM_SIZE) {
      content = content.slice(0, this.MAX_ITEM_SIZE) + "\n[TRUNCATED]";
    }

    const prompt = this.PROMPT.replace("{title}", item.title)
      .replace("{path}", item.path)
      .replace("{content}", content);

    const model = await this.chatModelManager.getChatModelWithTemperature(this.TEMPERATURE);
    const response = await model.invoke([new HumanMessage(prompt)]);

    return typeof response.content === "string" ? response.content.trim() : "";
  }

  /**
   * Reduce phase: rebuild content with summaries.
   */
  private rebuild(
    original: string,
    items: ParsedContextItem[],
    summaries: Map<number, string>
  ): string {
    let result = original;

    // Process from end to preserve indices
    Array.from(summaries.keys())
      .sort((a, b) => b - a)
      .forEach((index) => {
        const item = items[index];
        const summary = summaries.get(index)!;
        const newBlock = this.buildBlock(item, summary);
        result = result.slice(0, item.startIndex) + newBlock + result.slice(item.endIndex);
      });

    return result;
  }

  /** Block types that use <url> instead of <path> */
  private readonly URL_BASED_TYPES = [
    "url_content",
    "web_tab_context",
    "active_web_tab",
    "youtube_video_context",
  ];

  /**
   * Builds an XML block from a parsed item with its summary content.
   * @param item - The original parsed context item
   * @param summary - The summarized content to include
   * @returns The rebuilt XML block string with summary
   */
  private buildBlock(item: ParsedContextItem, summary: string): string {
    const parts = [`<${item.type}>`];

    if (item.title) parts.push(`<title>${item.title}</title>`);
    if (item.path) {
      const tag = this.URL_BASED_TYPES.includes(item.type) ? "url" : "path";
      parts.push(`<${tag}>${item.path}</${tag}>`);
    }
    if (item.metadata.ctime) parts.push(`<ctime>${item.metadata.ctime}</ctime>`);
    if (item.metadata.mtime) parts.push(`<mtime>${item.metadata.mtime}</mtime>`);
    parts.push(`<content>[SUMMARIZED]\n${summary}</content>`);
    parts.push(`</${item.type}>`);

    return parts.join("\n");
  }
}
