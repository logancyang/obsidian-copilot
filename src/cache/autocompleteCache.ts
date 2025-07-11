import { logInfo } from "@/logger";

interface CacheEntry<T = any> {
  response: T;
  timestamp: number;
}

export class AutocompleteCache {
  private static instance: AutocompleteCache;
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  private constructor() {
    this.cache = new Map();
    this.maxSize = 200; // Cache up to 200 completions (both word and sentence)
    this.ttlMs = 10 * 60 * 1000; // 10 minutes TTL
  }

  static getInstance(): AutocompleteCache {
    if (!AutocompleteCache.instance) {
      AutocompleteCache.instance = new AutocompleteCache();
    }
    return AutocompleteCache.instance;
  }

  get<T = any>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.response as T;
  }

  set<T = any>(key: string, response: T): void {
    // If cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
    });
    logInfo(`[AutocompleteCache] Cached response for key: ${key.slice(0, 50)}...`);
  }

  clear(): void {
    this.cache.clear();
    logInfo("[AutocompleteCache] Cleared autocomplete cache");
  }

  /**
   * Generate cache key for sentence completion
   */
  generateSentenceKey(prefix: string, noteContext: string, relevantNotes: string): string {
    // Create a hash-like key from the important parameters
    const keyData = {
      prefix: prefix.slice(-100), // Last 100 chars of prefix
      noteContext: noteContext.slice(-200), // Last 200 chars of note context
      relevantNotes: relevantNotes.slice(0, 100), // First 100 chars of relevant notes
    };

    return `sentence:${JSON.stringify(keyData)}`;
  }

  /**
   * Generate cache key for word completion
   */
  generateWordKey(contextPrefix: string, contextSuffix: string, suggestionWords: string[]): string {
    const keyData = {
      contextPrefix: contextPrefix.slice(-50), // Last 50 chars
      contextSuffix: contextSuffix.slice(0, 50), // First 50 chars
      words: suggestionWords.slice(0, 5), // First 5 suggestion words
    };

    return `word:${JSON.stringify(keyData)}`;
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}
