import { logInfo } from "@/logger";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { CompactionResult, ParsedContextItem } from "@/types/compaction";
import { HumanMessage } from "@langchain/core/messages";

export class ContextCompactor {
  private static instance: ContextCompactor;
  private chatModelManager: ChatModelManager;

  private readonly MIN_ITEM_SIZE = 50000;
  private readonly MAX_CONCURRENCY = 3;
  private readonly MAX_ITEM_SIZE = 500000;

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

  async compact(content: string): Promise<CompactionResult> {
    const originalCharCount = content.length;
    logInfo(`[ContextCompactor] Starting compaction of ${originalCharCount} chars`);

    const items = this.parseItems(content);
    if (items.length === 0) {
      return this.noOpResult(content);
    }

    const summaries = await this.summarizeItems(items);
    if (summaries.size === 0) {
      return this.noOpResult(content);
    }

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

    items.sort((a, b) => a.startIndex - b.startIndex);

    return items.filter(
      (item, i) =>
        !items.some(
          (other, j) =>
            i !== j && other.startIndex <= item.startIndex && other.endIndex >= item.endIndex
        )
    );
  }

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

  private async summarizeItems(items: ParsedContextItem[]): Promise<Map<number, string>> {
    const summaries = new Map<number, string>();

    const toProcess = items
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => item.content.length >= this.MIN_ITEM_SIZE);

    if (toProcess.length === 0) return summaries;

    logInfo(`[ContextCompactor] Summarizing ${toProcess.length} items`);

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

    if (summaries.size < toProcess.length * 0.5) {
      logInfo(`[ContextCompactor] High failure rate, aborting compaction`);
      return new Map();
    }

    return summaries;
  }

  private async summarize(item: ParsedContextItem): Promise<string> {
    let content = item.content;
    if (content.length > this.MAX_ITEM_SIZE) {
      content = content.slice(0, this.MAX_ITEM_SIZE) + "\n[TRUNCATED]";
    }

    const prompt = this.PROMPT.replace("{title}", item.title)
      .replace("{path}", item.path)
      .replace("{content}", content);

    const model = this.chatModelManager.getChatModel();
    const response = await model.invoke([new HumanMessage(prompt)]);

    return typeof response.content === "string" ? response.content.trim() : "";
  }

  private rebuild(
    original: string,
    items: ParsedContextItem[],
    summaries: Map<number, string>
  ): string {
    let result = original;

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

  private readonly URL_BASED_TYPES = [
    "url_content",
    "web_tab_context",
    "active_web_tab",
    "youtube_video_context",
  ];

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
