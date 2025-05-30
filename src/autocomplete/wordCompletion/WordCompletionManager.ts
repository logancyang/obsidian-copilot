import { logError } from "@/logger";
import { Vault } from "obsidian";
import { VaultTrie } from "./VaultTrie";
import { VaultWordScanner } from "./VaultWordScanner";
import { EnglishTokenizer } from "./tokenizers/EnglishTokenizer";
import { LanguageTokenizer } from "./tokenizers/LanguageTokenizer";
import {
  ScanProgress,
  VaultScanResult,
  WordCompletionPerformance,
  WordCompletionSettings,
  WordSuggestion,
} from "./types";

/**
 * Central manager for word completion functionality
 */
export class WordCompletionManager {
  private static instance: WordCompletionManager;
  private trie: VaultTrie;
  private scanner: VaultWordScanner;
  private vault: Vault;
  private settings: WordCompletionSettings;
  private performance: WordCompletionPerformance;
  private tokenizer: LanguageTokenizer;
  private isInitialized = false;
  private lastScanTime = 0;

  // Default settings
  private static readonly DEFAULT_SETTINGS: WordCompletionSettings = {
    enabled: true,
    minPrefixLength: 2,
    maxSuggestions: 20,
    includeVaultWords: true,
    includeFileNames: true,
    includeFolderNames: true,
    caseSensitive: false,
    minWordLength: 4,
    excludePatterns: [],
  };

  private static readonly DEFAULT_PERFORMANCE: WordCompletionPerformance = {
    maxTrieSize: 50000,
    maxFileSize: 1024 * 1024, // 1MB
    batchSize: 100,
  };

  private constructor(vault: Vault) {
    this.vault = vault;
    this.settings = { ...WordCompletionManager.DEFAULT_SETTINGS };
    this.performance = { ...WordCompletionManager.DEFAULT_PERFORMANCE };
    this.tokenizer = new EnglishTokenizer();

    this.trie = new VaultTrie(this.performance.maxTrieSize);
    this.scanner = new VaultWordScanner(
      this.vault,
      this.settings,
      this.performance,
      this.tokenizer
    );
  }

  static getInstance(vault: Vault): WordCompletionManager {
    if (!WordCompletionManager.instance) {
      WordCompletionManager.instance = new WordCompletionManager(vault);
    }
    return WordCompletionManager.instance;
  }

  /**
   * Initialize the word completion system
   */
  async initialize(progressCallback?: (progress: ScanProgress) => void): Promise<VaultScanResult> {
    if (this.isInitialized) {
      return {
        wordCount: this.trie.getStats().wordCount,
        fileCount: 0,
        errors: [],
        scanTimeMs: 0,
      };
    }

    try {
      // Wait a bit for vault to be fully loaded (especially important on plugin startup)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if vault seems ready
      const allFiles = this.vault.getAllLoadedFiles();

      if (allFiles.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Scan vault for words
      const result = await this.scanner.scanVault(progressCallback);

      // Add all discovered words to the trie
      await this.populateTrieFromScanResult(result);

      this.isInitialized = true;
      this.lastScanTime = Date.now();

      return result;
    } catch (error) {
      logError("[Word Completion] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Get word completion suggestions for a prefix
   */
  getSuggestions(prefix: string): WordSuggestion[] {
    if (!this.isInitialized || !this.settings.enabled) {
      return [];
    }

    if (!prefix || prefix.length < this.settings.minPrefixLength) {
      return [];
    }

    // Check if the prefix contains only word characters
    if (!this.tokenizer.isWordCharacter(prefix[prefix.length - 1])) {
      return [];
    }

    try {
      // For case-sensitive mode, use the original prefix
      // For case-insensitive mode, convert to lowercase
      const searchPrefix = this.settings.caseSensitive ? prefix : prefix.toLowerCase();

      const suggestions = this.trie.getSuggestions(searchPrefix, this.settings.maxSuggestions);

      // Filter out suggestions that match the prefix exactly
      const filtered = suggestions.filter(
        (suggestion: WordSuggestion) => suggestion.word.toLowerCase() !== prefix.toLowerCase()
      );

      return filtered;
    } catch (error) {
      logError("[Word Completion] Error getting suggestions:", error);
      return [];
    }
  }

  /**
   * Check if a word completion should be triggered for the current context
   */
  shouldTriggerCompletion(text: string, cursorPosition: number): boolean {
    if (!this.isInitialized || !this.settings.enabled) {
      return false;
    }

    // Get text up to cursor
    const textToCursor = text.substring(0, cursorPosition);

    // Find the current word being typed
    const currentWord = this.getCurrentWord(textToCursor);

    if (!currentWord || currentWord.length < this.settings.minPrefixLength) {
      return false;
    }

    // Don't trigger if we just typed a space/punctuation (check the character before cursor)
    if (cursorPosition > 0) {
      const charBeforeCursor = text[cursorPosition - 1];
      if (/\s/.test(charBeforeCursor)) {
        return false;
      }
    }

    // Check if we have any suggestions for this prefix
    const suggestions = this.getSuggestions(currentWord);
    const shouldTrigger = suggestions.length > 0;

    return shouldTrigger;
  }

  /**
   * Extract the current word being typed from text
   */
  private getCurrentWord(text: string): string {
    // Work backwards from the end to find word start
    let wordStart = text.length;

    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (!this.tokenizer.isWordCharacter(char)) {
        wordStart = i + 1;
        break;
      }
      if (i === 0) {
        wordStart = 0;
      }
    }

    return text.substring(wordStart).trim();
  }

  /**
   * Add a new word to the trie (e.g., when user types a new word)
   */
  addWord(word: string, context?: string): void {
    if (!this.isInitialized || !word || word.length < this.settings.minWordLength) {
      return;
    }

    if (this.tokenizer.isValidWord(word)) {
      // Normalize case based on settings
      const normalizedWord = this.settings.caseSensitive ? word : word.toLowerCase();
      this.trie.addWord(normalizedWord, context);
    }
  }

  /**
   * Get system statistics
   */
  getStats(): {
    isInitialized: boolean;
    trieStats: { wordCount: number; nodeCount: number; maxDepth: number };
    lastScanTime: number;
    settings: WordCompletionSettings;
  } {
    return {
      isInitialized: this.isInitialized,
      trieStats: this.trie.getStats(),
      lastScanTime: this.lastScanTime,
      settings: { ...this.settings },
    };
  }

  /**
   * Update settings
   */
  updateSettings(newSettings: Partial<WordCompletionSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.scanner.updateSettings(this.settings);
  }

  /**
   * Update performance settings
   */
  updatePerformance(newPerformance: Partial<WordCompletionPerformance>): void {
    this.performance = { ...this.performance, ...newPerformance };
    this.scanner.updatePerformance(this.performance);
  }

  /**
   * Clear the trie and reset
   */
  reset(): void {
    this.trie.clear();
    this.isInitialized = false;
    this.lastScanTime = 0;
  }

  /**
   * Manually trigger a vault rescan
   */
  async rescan(progressCallback?: (progress: ScanProgress) => void): Promise<VaultScanResult> {
    this.reset();
    return await this.initialize(progressCallback);
  }

  /**
   * Check if the system needs a rescan (placeholder for future file change detection)
   */
  needsRescan(): boolean {
    // For now, we don't automatically trigger rescans
    // This could be enhanced to detect file changes in the future
    return false;
  }

  /**
   * Get the current tokenizer
   */
  getTokenizer(): LanguageTokenizer {
    return this.tokenizer;
  }

  /**
   * Set a new tokenizer (for language switching)
   */
  setTokenizer(tokenizer: LanguageTokenizer): void {
    this.tokenizer = tokenizer;
    this.scanner.setTokenizer(tokenizer);
  }

  /**
   * Populate trie from scan result (private helper)
   */
  private async populateTrieFromScanResult(result: VaultScanResult): Promise<void> {
    const wordMap = (result as any).wordMap as Map<
      string,
      { frequency: number; contexts: Set<string> }
    >;

    if (!wordMap) {
      return;
    }

    for (const [word, data] of wordMap) {
      // For case-sensitive mode: store original case
      // For case-insensitive mode: normalize to lowercase
      const normalizedWord = this.settings.caseSensitive ? word : word.toLowerCase();

      // Add each word with its frequency
      for (let i = 0; i < data.frequency; i++) {
        this.trie.addWord(normalizedWord, Array.from(data.contexts)[0] || "vault");
      }
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.reset();
    WordCompletionManager.instance = null as any;
  }
}
