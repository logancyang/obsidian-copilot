import { AutocompleteCache } from "@/cache/autocompleteCache";
import { AUTOCOMPLETE_CONFIG } from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceableInlineSuggestion, type Suggestion } from "codemirror-companion-extension";
import { MarkdownView } from "obsidian";
import { AutocompletePostProcessor } from "./postProcessors";
import { getEditorContext, isNonSpaceDelimitedText, RelevantNotesCache } from "./utils";
import { WordCompletionManager } from "./wordCompletion";

export interface AutocompleteOptions {
  delay: number;
  minTriggerLength: number;
  maxContextLength: number;
}

// Valid accept key options
export type AcceptKeyOption = "Tab" | "Space" | "ArrowRight";

export class CodeMirrorIntegration {
  private static instance: CodeMirrorIntegration;
  private cache: AutocompleteCache;
  private client: BrevilabsClient;
  private extension: Extension;
  private forceFetch: () => void;
  private isActive = false;
  private postProcessor: AutocompletePostProcessor;
  private unsubscribeFromSettings: () => void;
  private acceptKey: AcceptKeyOption;

  // Word completion component
  private wordCompletionManager: WordCompletionManager;

  // Single global event listener for key handling
  private globalKeyListener: (e: KeyboardEvent) => void;

  // Request deduplication
  private activeRequests: Map<string, Promise<any>> = new Map();
  private lastRequestTime = 0;
  private readonly minRequestInterval = 100; // Minimum time between requests in ms
  private lastCursorPosition: { line: number; ch: number } | null = null;

  // Cache control
  private cacheEnabled = true;

  private constructor(private options: AutocompleteOptions) {
    this.cache = AutocompleteCache.getInstance();
    this.client = BrevilabsClient.getInstance();
    this.postProcessor = new AutocompletePostProcessor();

    // Initialize word completion
    this.wordCompletionManager = WordCompletionManager.getInstance(app.vault);

    // Get initial accept key from settings
    const settingsKey = getSettings().autocompleteAcceptKey || AUTOCOMPLETE_CONFIG.KEYBIND;
    // Ensure the key is one of the allowed options
    this.acceptKey = this.validateAcceptKey(settingsKey);

    // Create extension with initial config
    this.recreateExtension();

    // Set up global key handler
    this.setupGlobalKeyHandler();

    // Subscribe to settings changes
    this.unsubscribeFromSettings = subscribeToSettingsChange(this.handleSettingsChange);

    // Initialize word completion system
    this.initializeWordCompletion();
  }

  // Validate that the key is one of the allowed options
  private validateAcceptKey(key: string): AcceptKeyOption {
    const validKeys: AcceptKeyOption[] = ["Tab", "Space", "ArrowRight"];
    return validKeys.includes(key as AcceptKeyOption) ? (key as AcceptKeyOption) : "Tab";
  }

  /**
   * Initialize word completion system
   */
  private async initializeWordCompletion(): Promise<void> {
    const settings = getSettings();
    if (!settings.enableWordCompletion) {
      return;
    }

    try {
      await this.wordCompletionManager.initialize();
    } catch (error) {
      logError("[Copilot Autocomplete] Failed to initialize word completion:", error);
    }
  }

  private recreateExtension() {
    // Create a single unified extension that handles both word and sentence completion
    const { extension, force_fetch } = forceableInlineSuggestion({
      fetchFn: () => {
        return this.handleUnifiedCompletion();
      },
      delay: this.options.delay,
      continue_suggesting: false,
      accept_shortcut: null, // Handle all keys ourselves
    });

    this.extension = extension;
    this.forceFetch = force_fetch;

    // Update all active editors to ensure they have the latest extension
    this.updateActiveEditors();
  }

  /**
   * Set up a global key handler that will handle all key presses for autocomplete
   */
  private setupGlobalKeyHandler() {
    // Remove previous listener if it exists
    if (this.globalKeyListener) {
      document.removeEventListener("keydown", this.globalKeyListener, true);
    }

    // Create new listener
    this.globalKeyListener = (event: KeyboardEvent) => {
      if (!this.isActive) return;

      // Map key strings to event key values
      const keyMap: Record<AcceptKeyOption, string[]> = {
        Tab: ["Tab"],
        Space: [" ", "Space"],
        ArrowRight: ["ArrowRight", "Right"],
      };

      // Get active editor
      const activeView = app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView?.editor) return;

      const editorView = (activeView.editor as any).cm as EditorView;
      if (!editorView) return;

      // Check if we have an active completion
      const hasCompletion = this.hasActiveCompletion(editorView);

      // Get the key that matches this event
      let matchedKey: AcceptKeyOption | undefined;
      for (const [key, values] of Object.entries(keyMap)) {
        if (values.includes(event.key)) {
          matchedKey = key as AcceptKeyOption;
          break;
        }
      }

      // Handle accept key
      if (matchedKey === this.acceptKey && hasCompletion) {
        // Get the completion text from the unified extension
        const completionEl = editorView.dom.querySelector(".cm-inline-suggestion");
        const completionText = completionEl?.textContent || "";

        if (completionText) {
          // Prevent default behavior
          event.preventDefault();
          event.stopPropagation();

          // Get cursor position
          const cursorPos = editorView.state.selection.main.head;

          // Insert completion with appropriate separator
          const separator = matchedKey === "Space" ? " " : "";
          editorView.dispatch({
            changes: [
              {
                from: cursorPos,
                to: cursorPos,
                insert: completionText + separator,
              },
            ],
            selection: { anchor: cursorPos + completionText.length + separator.length },
          });

          // Clear suggestion
          this.forceFetch();
          return;
        }
      }

      // Handle Tab key specially when it's not the accept key
      if (event.key === "Tab" && this.acceptKey !== "Tab" && hasCompletion) {
        // Prevent default behavior
        event.preventDefault();
        event.stopPropagation();

        // Get cursor position
        const cursorPos = editorView.state.selection.main.head;

        // Insert tab
        editorView.dispatch({
          changes: [
            {
              from: cursorPos,
              to: cursorPos,
              insert: "\t",
            },
          ],
          selection: { anchor: cursorPos + 1 },
        });
      }
    };

    // Add listener with capture to get it before CodeMirror
    document.addEventListener("keydown", this.globalKeyListener, true);
  }

  private updateActiveEditors() {
    // Get all active markdown views
    const views = app.workspace.getLeavesOfType("markdown");

    for (const view of views) {
      const markdownView = view.view as MarkdownView;
      if (!markdownView?.editor) continue;

      // Access the editor's CM6 instance
      const editorView = (markdownView.editor as any).cm as EditorView;
      if (!editorView) continue;

      try {
        // Force a dispatch to update the editor
        editorView.dispatch({});
      } catch (error) {
        logError(`[Copilot Autocomplete] Error updating editor: ${error}`);
      }
    }
  }

  private handleSettingsChange = (prev: any, next: any) => {
    if (prev.autocompleteAcceptKey !== next.autocompleteAcceptKey) {
      const newKey = this.validateAcceptKey(next.autocompleteAcceptKey);
      this.acceptKey = newKey;

      // Update the global key handler
      this.setupGlobalKeyHandler();
    }

    if (prev.enableWordCompletion !== next.enableWordCompletion) {
      if (next.enableWordCompletion) {
        // Initialize word completion if it wasn't enabled before
        this.initializeWordCompletion();
      }

      // Recreate extension to include/exclude word completion
      this.recreateExtension();
    }
  };

  private hasActiveCompletion(view: EditorView): boolean {
    // Check for completion from the unified extension
    const selectors = [".cm-inline-suggestion", ".cm-ghost-text"];

    for (const selector of selectors) {
      const elements = Array.from(view.dom.querySelectorAll(selector));
      if (elements.length > 0) {
        return true;
      }
    }
    return false;
  }

  static getInstance(options: AutocompleteOptions): CodeMirrorIntegration {
    if (!CodeMirrorIntegration.instance) {
      CodeMirrorIntegration.instance = new CodeMirrorIntegration(options);
    }
    return CodeMirrorIntegration.instance;
  }

  setActive(active: boolean) {
    this.isActive = active;
  }

  getExtension(): Extension {
    return this.extension;
  }

  destroy() {
    // Clean up event listeners
    if (this.globalKeyListener) {
      document.removeEventListener("keydown", this.globalKeyListener, true);
    }

    if (this.unsubscribeFromSettings) {
      this.unsubscribeFromSettings();
    }

    // Clean up word completion resources
    if (this.wordCompletionManager) {
      this.wordCompletionManager.destroy();
    }

    // Clear any active requests
    this.activeRequests.clear();

    // Clear the cache
    this.cache.clear();
  }

  private shouldContinueSuggesting(prefix: string, suffix: string): boolean {
    // Don't suggest for Obsidian wiki links that just started
    if (prefix.endsWith("[[")) {
      return false;
    }

    // Check if we're in the middle of writing a note link
    // This regex matches if there's an open [[ without a closing ]] yet
    const wikiLinkRegex = /\[\[[^\]]*$/;
    if (wikiLinkRegex.test(prefix)) {
      // We're inside a wiki link, let Obsidian's native note completion handle this
      return false;
    }

    // Don't trigger if there's text after the cursor on the same line (middle of sentence)
    // Exception: allow if suffix starts with newline (cursor is at end of line)
    if (suffix && !suffix.startsWith("\n")) {
      return false;
    }

    // Check if we're right after heading markers (# ##, etc.) without content
    const lines = prefix.split("\n");
    const currentLine = lines[lines.length - 1];

    // Match heading markers that are either alone or followed only by spaces
    if (/^#{1,6}(\s*)$/.test(currentLine)) {
      return false;
    }

    // Get the last word, ignoring emojis and special characters
    const words = prefix
      .trim()
      .split(/\s+/)
      .filter((word) => word.replace(/[\p{Emoji}\p{Symbol}\p{Punctuation}]/gu, "").length > 0);
    const lastWord = words[words.length - 1] || "";

    // If contains CJK characters, always trigger
    if (isNonSpaceDelimitedText(lastWord)) {
      return true;
    }

    // For space-delimited languages (e.g., English), trigger on space
    return prefix.endsWith(" ");
  }

  private async *handleUnifiedCompletion(): AsyncGenerator<Suggestion> {
    if (!this.isActive) {
      return;
    }

    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return;
    }

    // Add small delay to ensure editor state is fully updated after keystrokes
    await new Promise((resolve) => setTimeout(resolve, 10));

    const editor = view.editor;
    const cursor = editor.getCursor();
    const { prefix, noteContext } = getEditorContext(editor, cursor);
    const suffix = editor.getLine(cursor.line).substring(cursor.ch) || "";

    // Check if cursor moved significantly (different line or >5 chars difference)
    if (this.lastCursorPosition) {
      const lineDiff = Math.abs(cursor.line - this.lastCursorPosition.line);
      const chDiff = Math.abs(cursor.ch - this.lastCursorPosition.ch);

      if (lineDiff > 0 || chDiff > 5) {
        this.clearActiveRequests();
      }
    }
    this.lastCursorPosition = { line: cursor.line, ch: cursor.ch };

    // Rate limiting: prevent too frequent requests
    const now = Date.now();
    if (now - this.lastRequestTime < this.minRequestInterval) {
      return;
    }

    // DECISION LOGIC: Determine whether to use word completion or sentence completion
    const settings = getSettings();
    const shouldUseWordCompletion = this.shouldUseWordCompletion(prefix, settings);

    if (shouldUseWordCompletion) {
      // Extract current word from prefix
      const currentWord = this.getCurrentWordFromPrefix(prefix);
      if (!currentWord || currentWord.length < 2) {
        return;
      }

      // Create request key for deduplication
      const requestKey = `word:${currentWord}:${prefix.slice(-50)}`;

      // Check if we already have an active request for this
      if (this.activeRequests.has(requestKey)) {
        return;
      }

      // Get word suggestions from trie
      const trieSuggestions = this.wordCompletionManager.getSuggestions(currentWord);
      if (trieSuggestions.length === 0) {
        return;
      }

      // Pre-filter optimization: Avoid wasteful API calls for complete words
      const isCurrentWordComplete = trieSuggestions.some(
        (suggestion) => suggestion.word === currentWord
      );

      const hasSignificantCompletions = trieSuggestions.some(
        (suggestion) => suggestion.word.length - currentWord.length >= 2
      );

      // If current word is complete and no significant completions exist, skip API call entirely
      // Example: typing "understand" when only "understand" exists in trie
      if (isCurrentWordComplete && !hasSignificantCompletions) {
        return; // No completion needed - user has typed a complete word
      }

      // If current word is complete but there are significant completions available,
      // filter out the exact match to focus API selection on meaningful extensions
      // Example: typing "understand" when "understanding", "understands" also exist
      const filteredSuggestions = isCurrentWordComplete
        ? trieSuggestions.filter((suggestion) => suggestion.word !== currentWord)
        : trieSuggestions;

      if (filteredSuggestions.length === 0) {
        return;
      }

      try {
        // Use LLM to select the best suggestion from trie results
        const suggestionWords = filteredSuggestions.map((s) => s.word);

        // Get enough context for LLM decision
        const contextPrefix = prefix.slice(-1000); // Last 200 chars for context
        const contextSuffix = suffix.slice(0, 500); // Next 100 chars for context

        // Check cache first (if enabled)
        let wordCompleteResponse;
        let cacheKey: string | undefined;
        let cachedResponse: any;

        if (this.cacheEnabled) {
          cacheKey = this.cache.generateWordKey(contextPrefix, contextSuffix, suggestionWords);
          cachedResponse = this.cache.get(cacheKey);
        }

        if (cachedResponse) {
          wordCompleteResponse = cachedResponse;
        } else {
          // Create and track the request
          const requestPromise = this.client.wordcomplete(
            contextPrefix,
            contextSuffix,
            suggestionWords
          );

          this.activeRequests.set(requestKey, requestPromise);
          this.lastRequestTime = now;

          wordCompleteResponse = await requestPromise;

          // Cache the response (if caching is enabled)
          if (this.cacheEnabled && cacheKey) {
            this.cache.set(cacheKey, wordCompleteResponse);
          }

          // Clean up the request from active requests
          this.activeRequests.delete(requestKey);
        }

        const selectedWord = wordCompleteResponse.response.selected_word;

        // Always use the API's selected word if we have one and it's different from current word
        if (selectedWord && selectedWord !== currentWord) {
          const completion = this.generateCaseMatchedCompletion(selectedWord, currentWord);
          if (completion) {
            yield {
              display_suggestion: completion,
              complete_suggestion: completion,
            };
          }
        }
      } catch (error) {
        // Clean up the request from active requests (only if we made a request)
        this.activeRequests.delete(requestKey);

        logError(
          "[Copilot Autocomplete] Error with LLM word selection, falling back to trie:",
          error
        );

        // Fallback to original trie-only logic on error
        const bestSuggestion = filteredSuggestions[0];
        const completion = this.generateCaseMatchedCompletion(bestSuggestion.word, currentWord);

        if (completion) {
          yield {
            display_suggestion: completion,
            complete_suggestion: completion,
          };
        }
      }
    } else {
      // Check if sentence completion is enabled
      if (!settings.enableAutocomplete) {
        return;
      }

      // Use sentence completion logic
      if (!this.shouldContinueSuggesting(prefix, suffix)) {
        return;
      }

      // Trim context if too long
      const trimmedPrefix = prefix.slice(-this.options.maxContextLength);

      if (trimmedPrefix.length < this.options.minTriggerLength) {
        return;
      }

      // Create request key for deduplication (use last 100 chars for reasonable uniqueness)
      const requestKey = `sentence:${trimmedPrefix.slice(-100)}`;

      // Check if we already have an active request for this
      if (this.activeRequests.has(requestKey)) {
        return;
      }

      try {
        // Check if additional context is allowed
        const shouldIncludeRelevantNotes = settings.allowAdditionalContext;

        // Get relevant notes from cache only if needed
        let relevantNotesStr = "";
        if (shouldIncludeRelevantNotes) {
          relevantNotesStr = await RelevantNotesCache.getInstance().getRelevantNotes(view.file);
        }

        // Prepend current note title to the prefix
        const currentNoteTitle = view.file?.basename || "";
        const prefixWithTitle = currentNoteTitle
          ? `[[${currentNoteTitle}]]:\n\n${trimmedPrefix}`
          : trimmedPrefix;

        // Check cache first (if enabled)
        let response;
        let cacheKey: string | undefined;
        let cachedResponse: any;

        if (this.cacheEnabled) {
          cacheKey = this.cache.generateSentenceKey(prefixWithTitle, noteContext, relevantNotesStr);
          cachedResponse = this.cache.get(cacheKey);
        }

        if (cachedResponse) {
          response = cachedResponse;
        } else {
          // Create and track the request
          const requestPromise = this.client.autocomplete(
            prefixWithTitle,
            noteContext,
            relevantNotesStr
          );

          this.activeRequests.set(requestKey, requestPromise);
          this.lastRequestTime = now;

          // Get completion from API
          response = await requestPromise;

          // Cache the response (if caching is enabled)
          if (this.cacheEnabled && cacheKey) {
            this.cache.set(cacheKey, response);
          }

          // Clean up the request from active requests
          this.activeRequests.delete(requestKey);
        }

        let completion = response.response.completion;

        // Apply post-processing to the completion
        const context = this.detectContext(prefix);
        completion = this.postProcessor.process(trimmedPrefix, suffix, completion, context);

        yield {
          display_suggestion: completion,
          complete_suggestion: completion,
        };
      } catch (error) {
        // Clean up the request from active requests (only if we made a request)
        this.activeRequests.delete(requestKey);

        logError("[Copilot Autocomplete] Error fetching autocomplete suggestions:", error);
      }
    }
  }

  /**
   * Determine if we should use word completion vs sentence completion
   */
  private shouldUseWordCompletion(prefix: string, settings: any): boolean {
    // Word completion is disabled
    if (!settings.enableWordCompletion) {
      return false;
    }

    // Don't suggest for Obsidian wiki links that just started
    if (prefix.endsWith("[[")) {
      return false;
    }

    // Check if we're in the middle of writing a note link
    // This regex matches if there's an open [[ without a closing ]] yet
    const wikiLinkRegex = /\[\[[^\]]*$/;
    if (wikiLinkRegex.test(prefix)) {
      // We're inside a wiki link, let Obsidian's native note completion handle this
      return false;
    }

    // Check if we're in the middle of typing a word
    const trimmedPrefix = prefix.trim();
    const lastChar = trimmedPrefix[trimmedPrefix.length - 1];

    // If the last character is a word character (letter/apostrophe), we might be in a word
    if (lastChar && /[a-zA-Z']/.test(lastChar)) {
      // Check if there's a current word of sufficient length
      const currentWord = this.getCurrentWordFromPrefix(prefix);
      if (currentWord && currentWord.length >= 2) {
        // Check if word is already complete and has no significant completions
        const trieSuggestions = this.wordCompletionManager.getSuggestions(currentWord);
        if (trieSuggestions.length === 0) {
          return false; // No suggestions available
        }

        const isCurrentWordComplete = trieSuggestions.some(
          (suggestion) => suggestion.word === currentWord
        );

        const hasSignificantCompletions = trieSuggestions.some(
          (suggestion) => suggestion.word.length - currentWord.length >= 2
        );

        // If current word is complete and no significant completions exist, don't trigger
        if (isCurrentWordComplete && !hasSignificantCompletions) {
          return false; // No meaningful completion needed
        }

        return true;
      }
    }

    return false;
  }

  /**
   * Extract current word from prefix
   */
  private getCurrentWordFromPrefix(prefix: string): string | null {
    // Work backwards to find word start
    let wordStart = prefix.length;
    for (let i = prefix.length - 1; i >= 0; i--) {
      const char = prefix[i];
      if (!/[a-zA-Z']/.test(char)) {
        wordStart = i + 1;
        break;
      }
      if (i === 0) {
        wordStart = 0;
      }
    }

    const currentWord = prefix.substring(wordStart);
    return currentWord.length >= 2 ? currentWord : null;
  }

  /**
   * Generate completion with case matching the user's prefix
   */
  private generateCaseMatchedCompletion(selectedWord: string, currentWord: string): string {
    if (selectedWord.length <= currentWord.length) {
      return "";
    }

    const completion = selectedWord.substring(currentWord.length);

    // Determine the case pattern of the current word
    const isAllUpperCase = currentWord === currentWord.toUpperCase();
    const isAllLowerCase = currentWord === currentWord.toLowerCase();
    const isTitleCase =
      currentWord.length > 0 &&
      currentWord[0] === currentWord[0].toUpperCase() &&
      currentWord.slice(1) === currentWord.slice(1).toLowerCase();

    // Apply the same case pattern to the completion
    if (isAllUpperCase) {
      return completion.toUpperCase();
    } else if (isAllLowerCase) {
      return completion.toLowerCase();
    } else if (isTitleCase) {
      // For title case, keep the completion as-is (usually lowercase after the first letter)
      return completion.toLowerCase();
    } else {
      // Mixed case - preserve original completion case
      return completion;
    }
  }

  /**
   * Detect the current context based on the prefix
   */
  private detectContext(prefix: string): string | undefined {
    const lastLine = prefix.split("\n").pop() || "";

    // Check for unordered list
    if (/^\s*[-*+]\s/.test(lastLine)) {
      return "UnorderedList";
    }

    // Check for numbered list
    if (/^\s*\d+\.\s/.test(lastLine)) {
      return "NumberedList";
    }

    // Check for task list
    if (/^\s*[-*+]\s\[[ x]\]\s/.test(lastLine)) {
      return "TaskList";
    }

    // Check for code block
    if (prefix.includes("```") && (prefix.split("```").length - 1) % 2 === 1) {
      return "CodeBlock";
    }

    return undefined;
  }

  triggerCompletion() {
    if (!this.isActive) {
      return;
    }
    // Clear any pending requests when manually triggering
    this.clearActiveRequests();
    this.forceFetch();
  }

  /**
   * Clear all active requests (useful when context changes significantly)
   */
  private clearActiveRequests() {
    if (this.activeRequests.size > 0) {
      this.activeRequests.clear();
    }
  }

  /**
   * Get the word completion manager for debugging
   */
  getWordCompletionManager() {
    return this.wordCompletionManager;
  }

  setCacheEnabled(enabled: boolean) {
    this.cacheEnabled = enabled;

    // Clear cache when disabling to ensure fresh start when re-enabled
    if (!enabled) {
      this.cache.clear();
    }
  }

  getCacheEnabled(): boolean {
    return this.cacheEnabled;
  }
}
