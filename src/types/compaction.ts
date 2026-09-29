export interface CompactionResult {
  content: string;
  wasCompacted: boolean;
  originalCharCount: number;
  compactedCharCount: number;
  itemsProcessed: number;
  itemsSummarized: number;
}

export interface ParsedContextItem {
  type: string;
  path: string;
  title: string;
  content: string;
  metadata: Record<string, string>;
  originalXml: string;
  startIndex: number;
  endIndex: number;
}
