import { findRelevantNotes } from "@/search/findRelevantNotes";
import VectorStoreManager from "@/search/vectorStoreManager";
import { Editor, TFile } from "obsidian";

/**
 * Unicode ranges for different writing systems
 * Reference: https://unicode.org/charts/
 */
const WRITING_SYSTEMS = {
  // CJK (Chinese, Japanese Kanji, Korean Hanja)
  cjk: [
    [0x4e00, 0x9fff], // CJK Unified
    [0x3400, 0x4dbf], // CJK Extension A
    [0x20000, 0x2a6df], // CJK Extension B
    [0x2a700, 0x2b73f], // CJK Extension C
    [0x2b740, 0x2b81f], // CJK Extension D
    [0x2b820, 0x2ceaf], // CJK Extension E
  ],
  // Japanese-specific
  japanese: [
    [0x3040, 0x309f], // Hiragana
    [0x30a0, 0x30ff], // Katakana
  ],
  // Korean-specific
  korean: [
    [0xac00, 0xd7af], // Hangul Syllables
    [0x1100, 0x11ff], // Hangul Jamo
  ],
  // Other non-space-delimited scripts
  other: [
    [0x0e00, 0x0e7f], // Thai
    [0x0600, 0x06ff], // Arabic
    [0x0900, 0x097f], // Devanagari (Hindi)
    [0x0980, 0x09ff], // Bengali
    [0x0a80, 0x0aff], // Gujarati
    [0x0b80, 0x0bff], // Tamil
  ],
} satisfies Record<string, Array<[number, number]>>;

/**
 * Tests if a character is within any of the given Unicode ranges
 */
function isInRanges(char: string, ranges: readonly number[][]): boolean {
  const code = char.codePointAt(0);
  if (!code) return false;
  return ranges.some(([start, end]) => code >= start && code <= end);
}

/**
 * Determines if the text contains any non-space-delimited writing systems
 * This includes CJK characters, Japanese kana, Korean hangul, and other scripts
 * that don't use spaces between words
 */
export function isNonSpaceDelimitedText(text: string): boolean {
  // Remove emojis and special characters before testing
  const cleanText = text.replace(/[\p{Emoji}\p{Symbol}\p{Punctuation}]/gu, "");
  if (!cleanText) return false;

  // Test each character against all writing systems
  for (const char of cleanText) {
    if (Object.values(WRITING_SYSTEMS).some((ranges) => isInRanges(char, ranges))) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the context around the cursor
 * @param editor The editor instance
 * @param cursor The cursor position
 * @returns Object containing prefix (a few lines before cursor) and noteContext (50 lines before/after with cursor marker)
 */
export function getEditorContext(
  editor: Editor,
  cursor: { line: number; ch: number }
): { prefix: string; noteContext: string } {
  let prefix = "";
  let noteContext = "";

  // Get last 5 lines for prefix
  const prefixStartLine = Math.max(0, cursor.line - 5);
  for (let i = prefixStartLine; i < cursor.line; i++) {
    prefix += editor.getLine(i) + "\n";
  }
  // Add content from cursor line up to cursor position
  const cursorLine = editor.getLine(cursor.line);
  prefix += cursorLine.slice(0, cursor.ch);

  // If cursor is at the end of an empty line or after a newline, add a newline to prefix
  if (cursor.ch === 0 || (cursor.ch === cursorLine.length && cursorLine.trim() === "")) {
    prefix += "\n";
  }

  // Get 50 lines before cursor for noteContext
  const contextStartLine = Math.max(0, cursor.line - 50);
  for (let i = contextStartLine; i < cursor.line; i++) {
    noteContext += editor.getLine(i) + "\n";
  }

  // Add cursor line with {{CURSOR}} marker
  noteContext += cursorLine.slice(0, cursor.ch) + "{{CURSOR}}" + cursorLine.slice(cursor.ch) + "\n";

  // Add up to 50 lines after cursor
  const contextEndLine = Math.min(editor.lineCount() - 1, cursor.line + 50);
  for (let i = cursor.line + 1; i <= contextEndLine; i++) {
    noteContext += editor.getLine(i) + "\n";
  }

  return { prefix, noteContext };
}

export class RelevantNotesCache {
  private static instance: RelevantNotesCache;
  private currentNotePath: string | null = null;
  private cachedNotes: string | null = null;
  private cachedNoteTitles: string[] = [];
  private static readonly MAX_RELEVANT_NOTES = 3;

  private constructor() {}

  static getInstance(): RelevantNotesCache {
    if (!RelevantNotesCache.instance) {
      RelevantNotesCache.instance = new RelevantNotesCache();
    }
    return RelevantNotesCache.instance;
  }

  /**
   * Gets the titles of currently cached relevant notes
   */
  getRelevantNoteTitles(): string[] {
    return this.cachedNoteTitles;
  }

  /**
   * Gets the formatted relevant notes string for the current note.
   * If the notes are already cached and the note hasn't changed, returns the cached version.
   * Otherwise, fetches and caches new relevant notes.
   */
  async getRelevantNotes(file: TFile | null): Promise<string> {
    // If no file is active, return empty string
    if (!file) {
      this.currentNotePath = null;
      this.cachedNotes = null;
      this.cachedNoteTitles = [];
      return "";
    }

    // If we already have cached notes for this file, return them
    if (this.currentNotePath === file.path && this.cachedNotes !== null) {
      return this.cachedNotes;
    }

    // Otherwise, fetch and cache new relevant notes
    const db = await VectorStoreManager.getInstance().getDb();
    const relevantNotes = await findRelevantNotes({ db, filePath: file.path });

    // Get top N relevant notes
    const topNotes = relevantNotes.slice(0, RelevantNotesCache.MAX_RELEVANT_NOTES);

    // Update cached titles
    this.cachedNoteTitles = topNotes.map((note) => note.document.title);

    // Format notes as required
    const formattedNotes = await Promise.all(
      topNotes.map(async (note) => {
        const noteFile = app.vault.getAbstractFileByPath(note.document.path);
        if (!(noteFile instanceof TFile)) return "";

        const content = await app.vault.cachedRead(noteFile);
        if (!content) return "";
        // Truncate content if over 3000 chars
        const truncatedContent = content.length > 3000 ? content.slice(0, 3000) + "..." : content;
        return `[[${note.document.title}]]:\n\n${truncatedContent}`;
      })
    );

    // Update cache
    this.currentNotePath = file.path;
    this.cachedNotes = formattedNotes.join("\n\n");

    return this.cachedNotes;
  }

  /**
   * Clears the cache, forcing a refresh on the next getRelevantNotes call
   */
  clearCache() {
    this.currentNotePath = null;
    this.cachedNotes = null;
    this.cachedNoteTitles = [];
  }
}
