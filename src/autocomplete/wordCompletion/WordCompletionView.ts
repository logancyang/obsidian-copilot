import { logError } from "@/logger";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceableInlineSuggestion, type Suggestion } from "codemirror-companion-extension";
import { MarkdownView } from "obsidian";
import { WordCompletionManager } from "./WordCompletionManager";

/**
 * Handles the visual integration of word completion with CodeMirror
 */
export class WordCompletionView {
  private manager: WordCompletionManager;
  private forceFetch: () => void;
  private lastTriggerTime = 0;
  private readonly debounceDelay: number;

  constructor(manager: WordCompletionManager, debounceDelay = 50) {
    this.manager = manager;
    this.debounceDelay = debounceDelay;
  }

  /**
   * Create a CodeMirror extension for word completion using the same library as phrase completion
   */
  createExtension(): Extension {
    // Use the exact same approach as phrase completion
    const { extension, force_fetch } = forceableInlineSuggestion({
      fetchFn: () => this.handleWordCompletion(),
      delay: this.debounceDelay,
      continue_suggesting: false,
      accept_shortcut: null, // Handle all keys ourselves (same as phrase completion)
    });

    this.forceFetch = force_fetch;
    return extension;
  }

  /**
   * Handle word completion suggestions using the same pattern as phrase completion
   */
  private async *handleWordCompletion(): AsyncGenerator<Suggestion> {
    try {
      // Get current editor state
      const activeView = app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView?.editor) {
        return;
      }

      const editor = activeView.editor;
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const textToCursor = line.substring(0, cursor.ch);

      // Extract current word
      const currentWord = this.getCurrentWord(textToCursor);
      if (!currentWord) {
        return;
      }

      // IMPORTANT: Only trigger if we're actually in the middle of typing a word
      // Don't trigger if we just completed a word (cursor is at space/punctuation)
      const nextChar = line[cursor.ch] || "";
      const prevChar = cursor.ch > 0 ? line[cursor.ch - 1] : "";

      // Don't trigger if the next character is part of a word (we're in the middle of an existing word)
      if (nextChar && /[a-zA-Z']/.test(nextChar)) {
        return;
      }

      // Only trigger if the previous character is a word character (we're actively typing)
      if (!prevChar || !/[a-zA-Z']/.test(prevChar)) {
        return;
      }

      // Check if we should trigger based on manager logic
      const doc = editor.getValue();
      if (!this.manager.shouldTriggerCompletion(doc, editor.posToOffset(cursor))) {
        return;
      }

      // Get suggestions
      const suggestions = this.manager.getSuggestions(currentWord);
      if (suggestions.length === 0) {
        return;
      }

      // Return the best suggestion in the same format as phrase completion
      const bestSuggestion = suggestions[0];
      const completion = bestSuggestion.word.substring(currentWord.length);

      if (completion) {
        yield {
          display_suggestion: completion,
          complete_suggestion: completion,
        };
      }
    } catch (error) {
      logError("[Word Completion View] Error in handleWordCompletion:", error);
    }
  }

  /**
   * Extract the current word being typed (same logic as before)
   */
  private getCurrentWord(textToCursor: string): string | null {
    // Work backwards to find word start
    let wordStart = textToCursor.length;
    for (let i = textToCursor.length - 1; i >= 0; i--) {
      const char = textToCursor[i];
      if (!/[a-zA-Z']/.test(char)) {
        wordStart = i + 1;
        break;
      }
      if (i === 0) {
        wordStart = 0;
      }
    }

    const currentWord = textToCursor.substring(wordStart);
    return currentWord.length >= 2 ? currentWord : null;
  }

  /**
   * Check if there's an active suggestion (same approach as phrase completion)
   */
  hasActiveSuggestion(): boolean {
    // Check if there's a .cm-inline-suggestion element (same as phrase completion)
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.editor) return false;

    const editorView = (activeView.editor as any).cm as EditorView;
    if (!editorView) return false;

    const completionEl = editorView.dom.querySelector(".cm-inline-suggestion");
    return !!completionEl?.textContent;
  }

  /**
   * Accept suggestion (handle it properly like sentence completion)
   */
  acceptSuggestion(view: EditorView): boolean {
    // Check if there's actually a word completion suggestion
    const completionEl = view.dom.querySelector(".cm-inline-suggestion");
    const completionText = completionEl?.textContent || "";

    if (!completionText) {
      return false;
    }

    try {
      // Get cursor position
      const cursorPos = view.state.selection.main.head;

      // Insert completion (same logic as sentence completion in codemirrorIntegration.ts)
      view.dispatch({
        changes: [
          {
            from: cursorPos,
            to: cursorPos,
            insert: completionText,
          },
        ],
        selection: { anchor: cursorPos + completionText.length },
      });

      // Clear suggestion by forcing a refresh
      this.forceFetch();

      return true;
    } catch (error) {
      logError("[Word Completion View] Error accepting suggestion:", error);
      return false;
    }
  }

  /**
   * Force refresh suggestions
   */
  triggerCompletion(): void {
    if (this.forceFetch) {
      this.forceFetch();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Nothing to clean up - the library handles everything
  }
}
