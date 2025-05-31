/**
 * Base interface for language-specific word tokenizers
 */
export interface LanguageTokenizer {
  /**
   * Extract words from text
   * @param text The text to extract words from
   * @returns Array of words found in the text
   */
  extractWords(text: string): string[];

  /**
   * Check if a character is considered part of a word in this language
   * @param char The character to check
   * @returns True if the character is a word character
   */
  isWordCharacter(char: string): boolean;

  /**
   * Check if a word is valid for this language
   * @param word The word to validate
   * @returns True if the word is valid
   */
  isValidWord(word: string): boolean;

  /**
   * Get the language identifier
   * @returns The language code (e.g., 'en', 'zh', 'ja')
   */
  getLanguage(): string;
}
