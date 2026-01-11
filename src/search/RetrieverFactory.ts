import { logInfo, logWarn } from "@/logger";
import { getSettings, CopilotSettings } from "@/settings/model";
import { App } from "obsidian";
import { SelfHostRetriever, VectorSearchBackend } from "./selfHostRetriever";
import { MergedSemanticRetriever } from "./v3/MergedSemanticRetriever";
import { TieredLexicalRetriever } from "./v3/TieredLexicalRetriever";

/**
 * Common options for all retriever types.
 * This interface unifies the configuration across different retriever implementations.
 */
export interface RetrieverOptions {
  /** Minimum similarity score threshold for results (0-1) */
  minSimilarityScore?: number;
  /** Maximum number of results to return */
  maxK: number;
  /** Additional terms to boost in search (defaults to empty array) */
  salientTerms?: string[];
  /** Optional time range filter */
  timeRange?: { startTime: number; endTime: number };
  /** Weight for text/keyword matching vs semantic (0-1) */
  textWeight?: number;
  /** Return all matching results up to a limit */
  returnAll?: boolean;
  /** Threshold for using reranker */
  useRerankerThreshold?: number;
  /** Return all documents matching tags */
  returnAllTags?: boolean;
  /** Tag terms to filter by */
  tagTerms?: string[];
}

/**
 * Internal options with defaults applied.
 * Used when passing options to concrete retriever implementations.
 */
interface NormalizedRetrieverOptions {
  minSimilarityScore: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll: boolean;
  useRerankerThreshold?: number;
  returnAllTags: boolean;
  tagTerms: string[];
}

/**
 * Result type indicating which retriever was selected and why.
 */
export interface RetrieverSelectionResult {
  retriever: DocumentRetriever;
  type: "self_hosted" | "semantic" | "lexical";
  reason: string;
}

/**
 * Normalize options by applying defaults.
 * Ensures all required fields are present with proper types.
 */
function normalizeOptions(options: RetrieverOptions): NormalizedRetrieverOptions {
  const tagTerms = options.tagTerms ?? [];
  const hasTagTerms = tagTerms.length > 0;

  return {
    minSimilarityScore: options.minSimilarityScore ?? 0.1,
    maxK: options.maxK,
    salientTerms: options.salientTerms ?? [],
    timeRange: options.timeRange,
    textWeight: options.textWeight,
    returnAll: hasTagTerms ? true : (options.returnAll ?? false),
    useRerankerThreshold: options.useRerankerThreshold,
    returnAllTags: hasTagTerms,
    tagTerms,
  };
}

/**
 * Common interface for retrievers that can get relevant documents.
 * This is the shared interface for SelfHostRetriever, MergedSemanticRetriever, and TieredLexicalRetriever.
 */
export interface DocumentRetriever {
  getRelevantDocuments(query: string): Promise<import("@langchain/core/documents").Document[]>;
}

/**
 * Factory for creating retrievers based on current settings.
 * Centralizes the retriever selection logic to avoid duplication across:
 * - VaultQAChainRunner
 * - CopilotPlusChainRunner (via SearchTools)
 * - Any other components that need search
 *
 * Priority order:
 * 1. Self-host mode / Miyo (if enabled and backend available)
 * 2. Semantic search / MergedSemanticRetriever (if enabled)
 * 3. Lexical search / TieredLexicalRetriever (default)
 */
export class RetrieverFactory {
  private static selfHostedBackend: VectorSearchBackend | null = null;

  /**
   * Register a self-host mode vector search backend.
   * This should be called during plugin initialization if self-host mode is configured.
   *
   * @param backend - The vector search backend implementation (e.g., Miyo)
   */
  static registerSelfHostedBackend(backend: VectorSearchBackend): void {
    RetrieverFactory.selfHostedBackend = backend;
    logInfo("RetrieverFactory: Self-hosted backend registered");
  }

  /**
   * Clear the registered self-hosted backend.
   * Call this when disabling self-host mode or during cleanup.
   */
  static clearSelfHostedBackend(): void {
    RetrieverFactory.selfHostedBackend = null;
    logInfo("RetrieverFactory: Self-hosted backend cleared");
  }

  /**
   * Check if a self-hosted backend is registered.
   */
  static hasSelfHostedBackend(): boolean {
    return RetrieverFactory.selfHostedBackend !== null;
  }

  /**
   * Create a retriever based on current settings.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   * @param settings - Optional settings override (defaults to current settings)
   * @returns Object containing the retriever and metadata about selection
   */
  static async createRetriever(
    app: App,
    options: RetrieverOptions,
    settings?: Partial<CopilotSettings>
  ): Promise<RetrieverSelectionResult> {
    const currentSettings = settings ? { ...getSettings(), ...settings } : getSettings();

    // Normalize options with defaults
    const normalizedOptions = normalizeOptions(options);

    // Self-host mode handling
    if (currentSettings.enableSelfHostMode) {
      // If fully configured, try to use self-host backend
      if (currentSettings.selfHostUrl && currentSettings.selfHostApiKey) {
        const backend = await RetrieverFactory.getSelfHostedBackend(currentSettings);
        if (backend) {
          const retriever = new SelfHostRetriever(app, backend, normalizedOptions);
          logInfo("RetrieverFactory: Using self-host mode backend");
          return {
            retriever,
            type: "self_hosted",
            reason: "Self-host mode is enabled and backend is available",
          };
        }
        logWarn("RetrieverFactory: Self-host mode backend unavailable, falling back to semantic");
      } else {
        logInfo(
          "RetrieverFactory: Self-host mode enabled but not fully configured, using semantic search"
        );
      }

      // Self-host mode enabled → always fall back to semantic (MergedSemanticRetriever)
      const retriever = new MergedSemanticRetriever(app, normalizedOptions);
      logInfo(
        "RetrieverFactory: Using MergedSemanticRetriever (semantic search fallback for self-host mode)"
      );
      return {
        retriever,
        type: "semantic",
        reason: "Self-host mode fallback to semantic search",
      };
    }

    // Standard mode: check enableSemanticSearchV3 setting
    if (currentSettings.enableSemanticSearchV3) {
      const retriever = new MergedSemanticRetriever(app, normalizedOptions);
      logInfo("RetrieverFactory: Using MergedSemanticRetriever (semantic search)");
      return {
        retriever,
        type: "semantic",
        reason: "Semantic search is enabled",
      };
    }

    // Default: Lexical search (TieredLexicalRetriever)
    const retriever = new TieredLexicalRetriever(app, normalizedOptions);
    logInfo("RetrieverFactory: Using TieredLexicalRetriever (lexical search)");
    return {
      retriever,
      type: "lexical",
      reason: "Default lexical search",
    };
  }

  /**
   * Create a retriever that forces lexical search regardless of settings.
   * Useful for time-range queries and tag-based searches that work better with lexical.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   * @returns The lexical retriever
   */
  static createLexicalRetriever(app: App, options: RetrieverOptions): TieredLexicalRetriever {
    return new TieredLexicalRetriever(app, normalizeOptions(options));
  }

  /**
   * Create a retriever that forces semantic search regardless of settings.
   * Useful when semantic understanding is specifically needed.
   *
   * @param app - Obsidian app instance
   * @param options - Retriever configuration options
   * @returns The semantic retriever
   */
  static createSemanticRetriever(app: App, options: RetrieverOptions): MergedSemanticRetriever {
    return new MergedSemanticRetriever(app, normalizeOptions(options));
  }

  /**
   * Get the self-hosted vector search backend.
   * Returns the registered backend if available.
   *
   * @param _settings - Settings containing backend configuration (reserved for future use)
   * @returns The vector search backend instance, or null if unavailable
   */
  private static async getSelfHostedBackend(
    _settings: CopilotSettings
  ): Promise<VectorSearchBackend | null> {
    // Return registered backend if available
    if (RetrieverFactory.selfHostedBackend) {
      try {
        const isAvailable = await RetrieverFactory.selfHostedBackend.isAvailable();
        if (isAvailable) {
          return RetrieverFactory.selfHostedBackend;
        }
        logWarn("RetrieverFactory: Registered backend is not available");
      } catch (error) {
        logWarn("RetrieverFactory: Error checking backend availability:", error);
      }
    }

    // No backend registered and we can't create one without implementation
    // This is a placeholder until a concrete backend (e.g., Miyo) is implemented
    logWarn(
      "RetrieverFactory: No self-hosted backend available. " +
        "Register a VectorSearchBackend implementation via RetrieverFactory.registerSelfHostedBackend()"
    );
    return null;
  }

  /**
   * Get the current retriever type based on settings without creating an instance.
   * Useful for UI display or debugging.
   *
   * @param settings - Optional settings override
   * @returns The type of retriever that would be created
   */
  static getRetrieverType(
    settings?: Partial<CopilotSettings>
  ): "self_hosted" | "semantic" | "lexical" {
    const currentSettings = settings ? { ...getSettings(), ...settings } : getSettings();

    // Self-host mode handling
    if (currentSettings.enableSelfHostMode) {
      // Fully configured with backend available → self_hosted
      if (
        currentSettings.selfHostUrl &&
        currentSettings.selfHostApiKey &&
        RetrieverFactory.selfHostedBackend
      ) {
        return "self_hosted";
      }
      // Self-host mode enabled but not ready → semantic fallback
      return "semantic";
    }

    // Standard mode
    if (currentSettings.enableSemanticSearchV3) {
      return "semantic";
    }

    return "lexical";
  }
}
