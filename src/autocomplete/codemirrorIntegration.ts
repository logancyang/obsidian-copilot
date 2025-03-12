import { AutocompleteCache } from "@/cache/autocompleteCache";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import { Extension } from "@codemirror/state";
import { forceableInlineSuggestion, type Suggestion } from "codemirror-companion-extension";
import { MarkdownView } from "obsidian";
import { getEditorContext, isNonSpaceDelimitedText, RelevantNotesCache } from "./utils";

export interface AutocompleteOptions {
  delay: number;
  minTriggerLength: number;
  maxContextLength: number;
}

export class CodeMirrorIntegration {
  private static instance: CodeMirrorIntegration;
  private cache: AutocompleteCache;
  private client: BrevilabsClient;
  private extension: Extension;
  private forceFetch: () => void;
  private isActive = false;
  private lastSuggestionTime: number = 0;
  private readonly MIN_SUGGESTION_INTERVAL = 200; // ms

  private constructor(private options: AutocompleteOptions) {
    this.cache = AutocompleteCache.getInstance();
    this.client = BrevilabsClient.getInstance();

    const { extension, force_fetch } = forceableInlineSuggestion({
      fetchFn: () => this.handleCompletion(),
      delay: this.options.delay,
      continue_suggesting: false,
      accept_shortcut: "Tab",
    });

    this.extension = extension;
    this.forceFetch = force_fetch;
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

  private canGenerateNewSuggestion(): boolean {
    const now = Date.now();
    if (now - this.lastSuggestionTime < this.MIN_SUGGESTION_INTERVAL) {
      return false;
    }
    this.lastSuggestionTime = now;
    return true;
  }

  private shouldContinueSuggesting(context: string): boolean {
    // Don't continue suggesting at the end of sentences
    if (/[.!?]\s$/.test(context)) return false;

    // Get the last word, ignoring emojis and special characters
    const words = context
      .trim()
      .split(/\s+/)
      .filter((word) => word.replace(/[\p{Emoji}\p{Symbol}\p{Punctuation}]/gu, "").length > 0);
    const lastWord = words[words.length - 1] || "";

    // If contains CJK characters, always trigger
    if (isNonSpaceDelimitedText(lastWord)) {
      return true;
    }

    // For space-delimited languages (e.g., English), trigger on space or newline
    return context.endsWith(" ") || context.endsWith("\n");
  }

  private async *handleCompletion(): AsyncGenerator<Suggestion> {
    if (!this.isActive) {
      logInfo("[Copilot Autocomplete] Autocomplete is not active");
      return;
    }

    if (!this.canGenerateNewSuggestion()) {
      logInfo("[Copilot Autocomplete] Rate limit - skipping suggestion");
      return;
    }

    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      logInfo("[Copilot Autocomplete] No active MarkdownView found");
      return;
    }

    const editor = view.editor;
    const cursor = editor.getCursor();
    const { prefix, noteContext } = getEditorContext(editor, cursor);

    // Check if we should continue suggesting based on context
    if (!this.shouldContinueSuggesting(prefix)) {
      logInfo("[Copilot Autocomplete] Context indicates no further suggestions needed");
      return;
    }

    // Trim context if too long
    const trimmedPrefix = prefix.slice(-this.options.maxContextLength);

    if (trimmedPrefix.length < this.options.minTriggerLength) {
      logInfo(
        `[Copilot Autocomplete] Prefix length ${trimmedPrefix.length} is below minimum trigger length ${this.options.minTriggerLength}`
      );
      return;
    }

    try {
      // Get relevant notes from cache
      const relevantNotesStr = await RelevantNotesCache.getInstance().getRelevantNotes(view.file);
      const relevantNoteTitles = RelevantNotesCache.getInstance().getRelevantNoteTitles();
      logInfo("[Copilot Autocomplete] Relevant notes:", relevantNoteTitles);

      // Prepend current note title to the prefix
      const currentNoteTitle = view.file?.basename || "";
      const prefixWithTitle = currentNoteTitle
        ? `[[${currentNoteTitle}]]:\n\n${trimmedPrefix}`
        : trimmedPrefix;

      // Get completion from API
      const response = await this.client.autocomplete(
        prefixWithTitle,
        noteContext,
        relevantNotesStr
      );

      const completion = response.response.completion;

      yield {
        display_suggestion: completion,
        complete_suggestion: completion,
      };
    } catch (error) {
      logError("[Copilot Autocomplete] Error fetching autocomplete suggestions:", error);
    }
  }

  triggerCompletion() {
    if (!this.isActive) {
      return;
    }
    this.forceFetch();
  }
}
