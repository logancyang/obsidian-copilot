import { LanguageTokenizer } from "./LanguageTokenizer";

/**
 * English language tokenizer with support for contractions and English-specific patterns
 */
export class EnglishTokenizer implements LanguageTokenizer {
  private readonly MIN_WORD_LENGTH = 4;

  // Common English words to exclude (helps reduce noise)
  private readonly STOP_WORDS = new Set([
    "a",
    "ain",
    "all",
    "am",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "d",
    "did",
    "do",
    "don",
    "few",
    "for",
    "had",
    "has",
    "he",
    "her",
    "him",
    "his",
    "how",
    "i",
    "if",
    "in",
    "is",
    "isn",
    "it",
    "its",
    "ll",
    "m",
    "ma",
    "me",
    "my",
    "no",
    "nor",
    "not",
    "now",
    "o",
    "of",
    "off",
    "on",
    "or",
    "our",
    "out",
    "own",
    "re",
    "s",
    "she",
    "so",
    "t",
    "the",
    "to",
    "too",
    "up",
    "ve",
    "was",
    "we",
    "who",
    "why",
    "won",
    "y",
    "you",
  ]);

  extractWords(text: string): string[] {
    // Remove markdown syntax and other noise
    const cleanText = this.preprocessText(text);

    // Extract words using regex that handles contractions
    // Matches: word, word's, don't, etc.
    const wordMatches = cleanText.match(/\b[a-zA-Z]+(?:'[a-zA-Z]+)?\b/g) || [];

    // Preserve original case but filter based on lowercase version
    return wordMatches.filter((word) => this.isValidWord(word));
  }

  isWordCharacter(char: string): boolean {
    return /[a-zA-Z']/.test(char);
  }

  isValidWord(word: string): boolean {
    // Must be at least minimum length
    if (word.length < this.MIN_WORD_LENGTH) {
      return false;
    }

    // Must be alphabetic (with possible apostrophe)
    if (!/^[a-zA-Z]+(?:'[a-zA-Z]+)?$/.test(word)) {
      return false;
    }

    // Exclude common stop words
    if (this.STOP_WORDS.has(word.toLowerCase())) {
      return false;
    }

    // Exclude words that are all uppercase (likely acronyms)
    if (word === word.toUpperCase() && word.length > 4) {
      return false;
    }

    return true;
  }

  getLanguage(): string {
    return "en";
  }

  /**
   * Remove markdown syntax and other noise from text before word extraction
   */
  private preprocessText(text: string): string {
    return (
      text
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, " ")
        // Remove inline code
        .replace(/`[^`]+`/g, " ")
        // Remove wiki links but keep the display text
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        // Remove regular links but keep the display text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Remove HTML tags
        .replace(/<[^>]+>/g, " ")
        // Remove markdown headers
        .replace(/^#+\s+/gm, "")
        // Remove bold/italic markers
        .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
        // Remove list markers
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        // Replace multiple whitespace with single space
        .replace(/\s+/g, " ")
        .trim()
    );
  }
}
