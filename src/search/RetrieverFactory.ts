import { logInfo } from "@/logger";
import { getSearchBackend } from "@/miyo/miyoUtils";
import { getSettings, CopilotSettings } from "@/settings/model";
import { App } from "obsidian";
import { MiyoSemanticRetriever } from "./miyo/MiyoSemanticRetriever";
import { TieredLexicalRetriever } from "./v3/TieredLexicalRetriever";

export interface RetrieverOptions {
  minSimilarityScore?: number;
  maxK: number;
  salientTerms?: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
  tagTerms?: string[];
}

interface NormalizedRetrieverOptions {
  minSimilarityScore: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll: boolean;
  useRerankerThreshold?: number;
  tagTerms: string[];
}

export interface RetrieverSelectionResult {
  retriever: DocumentRetriever;
  type: "semantic" | "lexical";
  reason: string;
}

function normalizeOptions(options: RetrieverOptions): NormalizedRetrieverOptions {
  return {
    minSimilarityScore: options.minSimilarityScore ?? 0.1,
    maxK: options.maxK,
    salientTerms: options.salientTerms ?? [],
    timeRange: options.timeRange,
    textWeight: options.textWeight,
    returnAll: options.returnAll ?? false,
    useRerankerThreshold: options.useRerankerThreshold,
    tagTerms: options.tagTerms ?? [],
  };
}

export interface DocumentRetriever {
  getRelevantDocuments(query: string): Promise<import("@langchain/core/documents").Document[]>;
}

export class RetrieverFactory {
  static async createRetriever(
    app: App,
    options: RetrieverOptions
  ): Promise<RetrieverSelectionResult> {
    const normalizedOptions = normalizeOptions(options);

    if (RetrieverFactory.shouldUseMiyo(getSettings())) {
      const retriever = RetrieverFactory.createMiyoRetriever(app, options);
      logInfo("RetrieverFactory: Using MiyoSemanticRetriever (standalone)");
      return {
        retriever,
        type: "semantic",
        reason: "Miyo search is enabled",
      };
    }

    // A legacy semantic-search flag may remain in data.json until its settings
    // migration, but it must not resurrect the removed client-side index.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/281
    const retriever = new TieredLexicalRetriever(app, normalizedOptions);
    logInfo("RetrieverFactory: Using TieredLexicalRetriever (lexical search)");
    return {
      retriever,
      type: "lexical",
      reason: "Default lexical search",
    };
  }

  static createLexicalRetriever(app: App, options: RetrieverOptions): TieredLexicalRetriever {
    return new TieredLexicalRetriever(app, normalizeOptions(options));
  }

  static getRetrieverType(): "semantic" | "lexical" {
    return RetrieverFactory.shouldUseMiyo(getSettings()) ? "semantic" : "lexical";
  }

  private static shouldUseMiyo(settings: CopilotSettings): boolean {
    return getSearchBackend(settings) === "miyo";
  }

  static isMiyoActive(): boolean {
    return RetrieverFactory.shouldUseMiyo(getSettings());
  }

  static createMiyoRetriever(app: App, options: RetrieverOptions): MiyoSemanticRetriever {
    return new MiyoSemanticRetriever(app, normalizeOptions(options));
  }
}
