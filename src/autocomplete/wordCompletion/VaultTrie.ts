import { WordEntry, WordSuggestion } from "./types";

/**
 * Case-sensitive trie node for storing words with frequency information
 */
interface TrieNode {
  children: Map<string, TrieNode>;
  isEndOfWord: boolean;
  wordEntry?: WordEntry;
}

/**
 * Case-sensitive trie implementation optimized for word completion
 * Can work standalone or with trie-search library when available
 */
export class VaultTrie {
  private root: TrieNode;
  private wordCount: number = 0;
  private readonly maxSize: number;

  constructor(maxSize: number = 50000) {
    this.root = this.createNode();
    this.maxSize = maxSize;
  }

  /**
   * Create a new trie node
   */
  private createNode(): TrieNode {
    return {
      children: new Map(),
      isEndOfWord: false,
      wordEntry: undefined,
    };
  }

  /**
   * Add a word to the trie or increment its frequency
   */
  addWord(word: string, context?: string): void {
    if (!word || word.length < 4) return;

    // Prevent trie from growing too large
    if (this.wordCount >= this.maxSize && !this.hasWord(word)) {
      return;
    }

    let node = this.root;

    // Traverse/create path for each character
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, this.createNode());
      }
      node = node.children.get(char)!;
    }

    // Mark end of word and update entry
    if (!node.isEndOfWord) {
      node.isEndOfWord = true;
      node.wordEntry = {
        word,
        frequency: 1,
        contexts: context ? [context] : [],
        lastSeen: Date.now(),
      };
      this.wordCount++;
    } else if (node.wordEntry) {
      // Update existing word
      node.wordEntry.frequency++;
      node.wordEntry.lastSeen = Date.now();

      // Add context if provided and not already present
      if (context && !node.wordEntry.contexts.includes(context)) {
        node.wordEntry.contexts.push(context);

        // Limit context array size to prevent memory bloat
        if (node.wordEntry.contexts.length > 10) {
          node.wordEntry.contexts = node.wordEntry.contexts.slice(-10);
        }
      }
    }
  }

  /**
   * Check if a word exists in the trie
   */
  hasWord(word: string): boolean {
    const node = this.findNode(word);
    return node !== null && node.isEndOfWord;
  }

  /**
   * Get the word entry for a specific word
   */
  getWordEntry(word: string): WordEntry | null {
    const node = this.findNode(word);
    if (node && node.isEndOfWord && node.wordEntry) {
      return node.wordEntry;
    }
    return null;
  }

  /**
   * Find the trie node for a given word/prefix
   */
  private findNode(prefix: string): TrieNode | null {
    let node = this.root;

    for (const char of prefix) {
      if (!node.children.has(char)) {
        return null;
      }
      node = node.children.get(char)!;
    }

    return node;
  }

  /**
   * Get word suggestions for a given prefix
   */
  getSuggestions(prefix: string, maxSuggestions: number = 10): WordSuggestion[] {
    if (!prefix) return [];

    // For case-sensitive mode, we need to find the best matching case variant
    const suggestions: WordSuggestion[] = [];

    // Try different case variants of the prefix
    const prefixVariants = this.generatePrefixVariants(prefix);

    for (const prefixVariant of prefixVariants) {
      const node = this.findNode(prefixVariant);
      if (node) {
        this.collectWords(node, prefixVariant, suggestions, maxSuggestions, prefix);
        if (suggestions.length >= maxSuggestions) break;
      }
    }

    // Remove duplicates and sort by score
    const uniqueSuggestions = this.deduplicateSuggestions(suggestions);
    uniqueSuggestions.sort((a, b) => b.score - a.score);

    return uniqueSuggestions.slice(0, maxSuggestions);
  }

  /**
   * Generate case variants for a prefix to support smart case matching
   */
  private generatePrefixVariants(prefix: string): string[] {
    const variants = new Set<string>();

    // Always include the original prefix
    variants.add(prefix);

    // Add lowercase variant
    variants.add(prefix.toLowerCase());

    // Add title case variant (first letter uppercase, rest lowercase)
    if (prefix.length > 0) {
      variants.add(prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase());
    }

    // Add uppercase variant
    variants.add(prefix.toUpperCase());

    return Array.from(variants);
  }

  /**
   * Remove duplicate suggestions (same word, keep highest score)
   */
  private deduplicateSuggestions(suggestions: WordSuggestion[]): WordSuggestion[] {
    const wordMap = new Map<string, WordSuggestion>();

    for (const suggestion of suggestions) {
      // Use the actual word as key to preserve case variants
      const key = suggestion.word;
      const existing = wordMap.get(key);

      if (!existing || suggestion.score > existing.score) {
        wordMap.set(key, suggestion);
      }
    }

    return Array.from(wordMap.values());
  }

  /**
   * Recursively collect words from a node with case-aware matching
   */
  private collectWords(
    node: TrieNode,
    currentWord: string,
    suggestions: WordSuggestion[],
    maxSuggestions: number,
    originalPrefix: string
  ): void {
    if (suggestions.length >= maxSuggestions) return;

    // If this node represents a complete word, add it to suggestions
    if (node.isEndOfWord && node.wordEntry) {
      const score =
        this.calculateScore(node.wordEntry) + this.getCaseMatchBonus(currentWord, originalPrefix);

      suggestions.push({
        word: currentWord,
        score,
        source: "vault" as const,
      });
    }

    // Continue to children
    for (const [char, childNode] of node.children) {
      this.collectWords(childNode, currentWord + char, suggestions, maxSuggestions, originalPrefix);
    }
  }

  /**
   * Calculate case match bonus for better ranking
   */
  private getCaseMatchBonus(word: string, originalPrefix: string): number {
    if (word.length < originalPrefix.length) return 0;

    const wordPrefix = word.substring(0, originalPrefix.length);

    // Exact case match gets highest bonus
    if (wordPrefix === originalPrefix) {
      return 2;
    }

    // Same case pattern (e.g., "Test" matches "Te") gets medium bonus
    if (this.hasSameCasePattern(wordPrefix, originalPrefix)) {
      return 1.5;
    }

    // Any match gets small bonus
    return 1;
  }

  /**
   * Check if two strings have the same case pattern
   */
  private hasSameCasePattern(word: string, prefix: string): boolean {
    if (word.length < prefix.length) return false;

    for (let i = 0; i < prefix.length; i++) {
      const wordChar = word[i];
      const prefixChar = prefix[i];

      const wordIsUpper = wordChar === wordChar.toUpperCase();
      const prefixIsUpper = prefixChar === prefixChar.toUpperCase();

      if (wordIsUpper !== prefixIsUpper) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate score for a word entry based on frequency and recency
   */
  private calculateScore(entry: WordEntry): number {
    const frequencyScore = Math.log(entry.frequency + 1) * 10;
    const recencyScore = Math.max(0, (Date.now() - entry.lastSeen) / (1000 * 60 * 60 * 24)); // Days ago
    const recencyBonus = Math.max(0, 10 - recencyScore); // Bonus decreases with age

    return frequencyScore + recencyBonus;
  }

  /**
   * Get statistics about the trie
   */
  getStats(): { wordCount: number; nodeCount: number; maxDepth: number } {
    let nodeCount = 0;
    let maxDepth = 0;

    const countNodes = (node: TrieNode, depth: number = 0): void => {
      nodeCount++;
      maxDepth = Math.max(maxDepth, depth);

      for (const child of node.children.values()) {
        countNodes(child, depth + 1);
      }
    };

    countNodes(this.root);

    return {
      wordCount: this.wordCount,
      nodeCount,
      maxDepth,
    };
  }

  /**
   * Clear all words from the trie
   */
  clear(): void {
    this.root = this.createNode();
    this.wordCount = 0;
  }

  /**
   * Get all words in the trie
   */
  getAllWords(): WordEntry[] {
    const words: WordEntry[] = [];

    const collectAllWords = (node: TrieNode): void => {
      if (node.isEndOfWord && node.wordEntry) {
        words.push(node.wordEntry);
      }

      for (const child of node.children.values()) {
        collectAllWords(child);
      }
    };

    collectAllWords(this.root);
    return words;
  }

  /**
   * Add multiple words at once
   */
  addWords(words: string[], context?: string): void {
    for (const word of words) {
      this.addWord(word, context);
    }
  }

  /**
   * Remove words with frequency below threshold
   */
  pruneByFrequency(minFrequency: number = 2): number {
    let removedCount = 0;

    const pruneNode = (node: TrieNode): boolean => {
      // First, recursively prune children
      const childrenToRemove: string[] = [];
      for (const [char, child] of node.children) {
        if (pruneNode(child)) {
          childrenToRemove.push(char);
        }
      }

      // Remove pruned children
      for (const char of childrenToRemove) {
        node.children.delete(char);
      }

      // Check if this node should be pruned
      if (node.isEndOfWord && node.wordEntry && node.wordEntry.frequency < minFrequency) {
        node.isEndOfWord = false;
        node.wordEntry = undefined;
        this.wordCount--;
        removedCount++;
      }

      // Return true if this node should be removed (no children and not end of word)
      return node.children.size === 0 && !node.isEndOfWord;
    };

    pruneNode(this.root);
    return removedCount;
  }
}
