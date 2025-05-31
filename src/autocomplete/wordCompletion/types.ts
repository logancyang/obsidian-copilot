/**
 * Core types for the word completion system
 */

export interface WordEntry {
  word: string;
  frequency: number;
  contexts: string[]; // Files where word appears
  lastSeen: number; // Timestamp for recency scoring
}

export interface WordCompletionSettings {
  enabled: boolean;
  minPrefixLength: number; // Default: 2
  maxSuggestions: number; // Default: 20
  includeVaultWords: boolean; // Default: true
  includeFileNames: boolean; // Default: true
  includeFolderNames: boolean; // Default: true
  caseSensitive: boolean; // Default: true
  minWordLength: number; // Default: 4
  excludePatterns: string[]; // Regex patterns to exclude
}

export interface WordCompletionPerformance {
  maxTrieSize: number; // Default: 50000
  maxFileSize: number; // Default: 1MB - skip files larger than this
  batchSize: number; // Default: 100 - files to process per batch
}

export interface WordSuggestion {
  word: string;
  score: number; // Combined frequency + recency score
  source: "vault" | "filename" | "dictionary";
}

export interface ScanProgress {
  currentFile?: string;
  processedFiles: number;
  totalFiles: number;
  foundWords: number;
}

export interface VaultScanResult {
  wordCount: number;
  fileCount: number;
  errors: string[];
  scanTimeMs: number;
  wordMap?: Map<string, { frequency: number; contexts: Set<string> }>; // Internal use only
}
