import { logError } from "@/logger";
import { TFile, TFolder, Vault } from "obsidian";
import { EnglishTokenizer } from "./tokenizers/EnglishTokenizer";
import { LanguageTokenizer } from "./tokenizers/LanguageTokenizer";
import {
  ScanProgress,
  VaultScanResult,
  WordCompletionPerformance,
  WordCompletionSettings,
} from "./types";

/**
 * Scans vault content to extract words for the trie
 */
export class VaultWordScanner {
  private vault: Vault;
  private tokenizer: LanguageTokenizer;
  private settings: WordCompletionSettings;
  private performance: WordCompletionPerformance;
  private isScanning = false;
  private progressCallback?: (progress: ScanProgress) => void;

  constructor(
    vault: Vault,
    settings: WordCompletionSettings,
    performance: WordCompletionPerformance,
    tokenizer?: LanguageTokenizer
  ) {
    this.vault = vault;
    this.settings = settings;
    this.performance = performance;
    this.tokenizer = tokenizer || new EnglishTokenizer();
  }

  /**
   * Main method to scan the entire vault
   */
  async scanVault(progressCallback?: (progress: ScanProgress) => void): Promise<VaultScanResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const wordMap = new Map<string, { frequency: number; contexts: Set<string> }>();

    try {
      // Get all markdown files
      const files = this.vault.getMarkdownFiles();

      let processedFiles = 0;

      for (const file of files) {
        try {
          // Update progress
          if (progressCallback) {
            progressCallback({
              currentFile: file.path,
              processedFiles,
              totalFiles: files.length,
              foundWords: wordMap.size,
            });
          }

          // Skip very large files to avoid performance issues
          try {
            const stat = await this.vault.adapter.stat(file.path);
            if (stat && stat.size > this.performance.maxFileSize) {
              errors.push(`Skipped large file: ${file.path}`);
              continue;
            }
          } catch {
            // Continue processing even if we can't get file stats
          }

          // Read and process file
          const content = await this.vault.read(file);
          await this.processFile(file.path, content, wordMap);

          processedFiles++;

          // Process in batches to avoid blocking the UI
          if (processedFiles % this.performance.batchSize === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        } catch (error) {
          const errorMsg = `Error processing file ${file.path}: ${error}`;
          logError(errorMsg);
          errors.push(errorMsg);
        }
      }

      // Also scan file and folder names if enabled
      if (this.settings.includeFileNames || this.settings.includeFolderNames) {
        this.processFileAndFolderNames(wordMap);
      }

      const scanTimeMs = Date.now() - startTime;
      const result: VaultScanResult = {
        wordCount: wordMap.size,
        fileCount: processedFiles,
        errors,
        scanTimeMs,
        wordMap, // Include the word map for population
      };

      return result;
    } catch (error) {
      logError("[Word Completion] Vault scan failed:", error);
      throw error;
    }
  }

  /**
   * Scan a single file for words
   */
  async scanFile(file: TFile): Promise<string[]> {
    // Skip files that are too large
    if (file.stat.size > this.performance.maxFileSize) {
      return [];
    }

    // Only process markdown files
    if (file.extension !== "md") {
      return [];
    }

    try {
      const content = await this.vault.read(file);
      return this.extractWordsFromText(content);
    } catch (error) {
      logError(`[Word Completion] Error reading file ${file.path}:`, error);
      return [];
    }
  }

  /**
   * Extract words from text content
   */
  private extractWordsFromText(text: string): string[] {
    if (!text || text.trim().length === 0) return [];

    // Use tokenizer to extract words
    const words = this.tokenizer.extractWords(text);

    // Filter words based on settings
    return words.filter((word) => {
      // Check minimum length
      if (word.length < this.settings.minWordLength) {
        return false;
      }

      // Check exclude patterns
      for (const pattern of this.settings.excludePatterns) {
        try {
          const regex = new RegExp(pattern, "i");
          if (regex.test(word)) {
            return false;
          }
        } catch (error) {
          // Invalid regex pattern, skip it
          logError(`[Word Completion] Invalid exclude pattern: ${pattern}`, error);
        }
      }

      return true;
    });
  }

  /**
   * Extract words from file and folder names
   */
  private extractPathWords(): string[] {
    const words = new Set<string>();

    const processPath = (path: string) => {
      // Split path into components
      const components = path.split("/").filter(Boolean);

      for (const component of components) {
        // Remove file extension
        const nameWithoutExt = component.replace(/\.[^.]+$/, "");

        // Extract words from the name (split on non-word characters)
        const pathWords = nameWithoutExt
          .split(/[^a-zA-Z]+/)
          .filter((word) => word.length >= this.settings.minWordLength)
          .filter((word) => this.tokenizer.isValidWord(word));

        pathWords.forEach((word) => words.add(word.toLowerCase()));
      }
    };

    // Process all files
    if (this.settings.includeFileNames) {
      this.vault.getMarkdownFiles().forEach((file) => {
        processPath(file.path);
      });
    }

    // Process all folders
    if (this.settings.includeFolderNames) {
      const processFolders = (folder: TFolder) => {
        processPath(folder.path);
        folder.children.forEach((child) => {
          if (child instanceof TFolder) {
            processFolders(child);
          }
        });
      };

      processFolders(this.vault.getRoot());
    }

    return Array.from(words);
  }

  /**
   * Get list of files that should be scanned
   */
  private getFilesToScan(): TFile[] {
    return this.vault.getMarkdownFiles().filter((file) => {
      // Skip files that are too large
      if (file.stat.size > this.performance.maxFileSize) {
        return false;
      }

      // Additional filtering can be added here
      return true;
    });
  }

  /**
   * Check if scanning is currently in progress
   */
  isScanningScanVault(): boolean {
    return this.isScanning;
  }

  /**
   * Get estimated scan time based on vault size
   */
  getEstimatedScanTime(): number {
    const files = this.getFilesToScan();
    const totalSize = files.reduce((sum, file) => sum + file.stat.size, 0);

    // Rough estimate: 1MB per second
    const estimatedSeconds = Math.max(1, totalSize / (1024 * 1024));
    return estimatedSeconds * 1000; // Return in milliseconds
  }

  /**
   * Set tokenizer (useful for changing language)
   */
  setTokenizer(tokenizer: LanguageTokenizer): void {
    this.tokenizer = tokenizer;
  }

  /**
   * Update settings
   */
  updateSettings(settings: WordCompletionSettings): void {
    this.settings = settings;
  }

  /**
   * Update performance settings
   */
  updatePerformance(performance: WordCompletionPerformance): void {
    this.performance = performance;
  }

  private async processFile(
    filePath: string,
    content: string,
    wordMap: Map<string, { frequency: number; contexts: Set<string> }>
  ): Promise<void> {
    const words = this.extractWordsFromText(content);
    for (const word of words) {
      if (!wordMap.has(word)) {
        wordMap.set(word, { frequency: 0, contexts: new Set() });
      }
      const entry = wordMap.get(word)!;
      entry.frequency++;
      entry.contexts.add(filePath);
    }
  }

  private processFileAndFolderNames(
    wordMap: Map<string, { frequency: number; contexts: Set<string> }>
  ): void {
    const pathWords = this.extractPathWords();
    for (const word of pathWords) {
      if (!wordMap.has(word)) {
        wordMap.set(word, { frequency: 0, contexts: new Set() });
      }
      wordMap.get(word)!.frequency++;
      wordMap.get(word)!.contexts.add("filename");
    }
  }
}
