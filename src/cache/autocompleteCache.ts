import { logInfo } from "@/logger";

interface CacheEntry {
  completion: string;
  timestamp: number;
}

export class AutocompleteCache {
  private static instance: AutocompleteCache;
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  private constructor() {
    this.cache = new Map();
    this.maxSize = 100; // Cache up to 100 completions
    this.ttlMs = 5 * 60 * 1000; // 5 minutes TTL
  }

  static getInstance(): AutocompleteCache {
    if (!AutocompleteCache.instance) {
      AutocompleteCache.instance = new AutocompleteCache();
    }
    return AutocompleteCache.instance;
  }

  get(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.completion;
  }

  set(key: string, completion: string): void {
    // If cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      completion,
      timestamp: Date.now(),
    });
    logInfo("Cached autocomplete suggestion for key:", key);
  }

  clear(): void {
    this.cache.clear();
    logInfo("Cleared autocomplete cache");
  }

  generateKey(prefix: string): string {
    // Use last N characters as key to keep context relevant
    const keyLength = 100;
    return prefix.length <= keyLength ? prefix : prefix.slice(prefix.length - keyLength);
  }
}
