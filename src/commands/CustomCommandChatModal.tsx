import { CustomModel, useModelKey } from "@/aiParams";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { MenuCommandModal, type ContentState } from "@/components/command-ui";
import {
  MODAL_MIN_HEIGHT_COMPACT,
  MODAL_MIN_HEIGHT_EXPANDED,
} from "@/components/command-ui/constants";
import { SelectionHighlight } from "@/editor/selectionHighlight";
import { createHighlightReplaceGuard, type ReplaceGuard } from "@/editor/replaceGuard";
import { logError } from "@/logger";
import { cleanMessageForCopy, findCustomModel, insertIntoEditor } from "@/utils";
import { computeVerticalPlacement } from "@/utils/panelPlacement";
import { computeSelectionAnchors } from "@/utils/selectionAnchors";
import type { EditorView } from "@codemirror/view";
import { PenLine } from "lucide-react";
import { App, Component, MarkdownRenderer, Notice, MarkdownView, Scope } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preprocessAIResponse } from "@/utils/markdownPreprocess";
import { createRoot, Root } from "react-dom/client";
import { CustomCommand } from "@/commands/type";
import { useSettingsValue, updateSetting } from "@/settings/model";
import {
  useStreamingChatSession,
  type StreamingChatTurnContext,
} from "@/hooks/use-streaming-chat-session";
import { ABORT_REASON } from "@/constants";

// ============================================================================
// Behavior Config - Replaces mode-based branching
// ============================================================================

/**
 * Model selection scope determines how model changes are persisted.
 * - 'quick-command': Changes persist to quickCommandModelKey (shared with Quick Ask)
 * - 'custom-command': Changes only affect current session (respects command-level config)
 */
export type ModelSelectionScope = "quick-command" | "custom-command";

/**
 * Configuration for modal behavior.
 * This replaces the mode-based branching with explicit configuration.
 */
export interface ModalBehaviorConfig {
  /** Whether to auto-execute the command on open (menu mode: true, quick mode: false) */
  autoExecuteOnOpen: boolean;
  /** Whether to hide ContentArea when state is idle */
  hideContentAreaOnIdle: boolean;
  /** Transform function for first submit (e.g., append note context placeholders) */
  firstSubmitTransform?: (input: string, includeNoteContext: boolean) => string;
  /** Label to display in the modal header */
  commandLabel: string;
  /** Icon to display in the modal header (null for no icon, undefined for default) */
  commandIcon?: React.ReactNode | null;
  /** Whether to show the "Include note context" checkbox */
  showIncludeNoteContext?: boolean;
  /**
   * Model selection scope - determines persistence behavior.
   * - 'quick-command': Persists to quickCommandModelKey (default for Quick Command)
   * - 'custom-command': Only affects current session (default for Custom Commands)
   */
  modelSelectionScope?: ModelSelectionScope;
}

/**
 * Resolves modal behavior defaults and caller overrides.
 */
function resolveBehaviorConfig(
  command: CustomCommand,
  overrides?: Partial<ModalBehaviorConfig>
): ModalBehaviorConfig {
  const defaults: ModalBehaviorConfig = {
    autoExecuteOnOpen: true,
    hideContentAreaOnIdle: false,
    commandLabel: command.title,
    commandIcon: <PenLine className="tw-size-4 tw-text-muted" />,
  };

  return { ...defaults, ...overrides };
}

// ============================================================================
// Content Component
// ============================================================================

interface CustomCommandChatModalContentProps {
  originalText: string;
  command: CustomCommand;
  onInsert: (message: string) => void;
  onReplace: (message: string) => void;
  onClose: () => void;
  systemPrompt?: string;
  initialPosition?: { x: number; y: number };
  /** Bottom-anchor Y for "above" placement (panel grows upward) */
  anchorBottom?: number;
  behaviorConfig?: Partial<ModalBehaviorConfig>;
}

/**
 * Content component for CustomCommandChatModal using the new MenuCommandModal.
 */
function CustomCommandChatModalContent({
  originalText,
  command,
  onInsert,
  onReplace,
  onClose,
  systemPrompt,
  initialPosition,
  anchorBottom,
  behaviorConfig,
}: CustomCommandChatModalContentProps) {
  // Resolve behavior configuration
  const behavior = useMemo(
    () => resolveBehaviorConfig(command, behaviorConfig),
    [command, behaviorConfig]
  );

  // Prevent concurrent submissions (double-Enter / re-entrancy).
  const followUpSubmitLockRef = useRef(false);
  // Track mount state to avoid setState on unmounted component
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reason: Create Component synchronously so renderMarkdown is available
  // on the first render (child effects run before parent effects).
  const obsidianComponentRef = useRef<Component | null>(null);
  if (!obsidianComponentRef.current) {
    const comp = new Component();
    comp.load();
    obsidianComponentRef.current = comp;
  }
  useEffect(() => {
    return () => {
      obsidianComponentRef.current?.unload();
      obsidianComponentRef.current = null;
    };
  }, []);

  // Reason: Snapshot file path at mount time for stable Markdown link resolution.
  // Using dynamic getActiveFile() would resolve links against whichever note
  // the user switches to after opening the modal.
  const filePathSnapshotRef = useRef(app.workspace.getActiveFile()?.path ?? "");

  /**
   * Renders markdown content into a DOM element using Obsidian's MarkdownRenderer.
   * Passed to ContentArea to enable preview mode for completed results.
   */
  const renderMarkdown = useCallback(async (content: string, el: HTMLElement) => {
    const comp = obsidianComponentRef.current;
    if (!comp) return;
    const preprocessed = preprocessAIResponse(content);
    await MarkdownRenderer.renderMarkdown(preprocessed, el, filePathSnapshotRef.current, comp);
  }, []);

  // State
  const [finalText, setFinalText] = useState<string>("");
  const [editedText, setEditedText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(behavior.autoExecuteOnOpen);
  const [followUpValue, setFollowUpValue] = useState("");

  // Model selection
  const [globalModelKey] = useModelKey();
  const settings = useSettingsValue();
  const modelSelectionScope = behavior.modelSelectionScope ?? "custom-command";

  // Determine initial model key based on scope:
  // - quick-command: Use quickCommandModelKey (shared with Quick Ask)
  // - custom-command: Use command's modelKey if set, otherwise global model
  const initialModelKey = useMemo(() => {
    if (modelSelectionScope === "quick-command") {
      // Use ?? to match QuickAskPanel behavior (empty string is valid, only null/undefined falls back)
      return settings.quickCommandModelKey ?? globalModelKey;
    }
    // For custom-command scope, respect command-level config
    // Use || here because empty string means "inherit from global"
    return command.modelKey || globalModelKey;
  }, [modelSelectionScope, settings.quickCommandModelKey, command.modelKey, globalModelKey]);

  const [userSelectedModelKey, setUserSelectedModelKey] = useState(initialModelKey);

  // Handle model change with scope-aware persistence
  const handleModelChange = useCallback(
    (newModelKey: string) => {
      setUserSelectedModelKey(newModelKey);
      // Only persist for quick-command scope (shared with Quick Ask)
      if (modelSelectionScope === "quick-command") {
        updateSetting("quickCommandModelKey", newModelKey);
      }
      // For custom-command scope, changes only affect current session
    },
    [modelSelectionScope]
  );

  // Include note context state (for Quick Command mode)
  // Use local state for immediate UI updates, sync to settings on change
  const [includeNoteContext, setIncludeNoteContext] = useState(
    () => settings.quickCommandIncludeNoteContext
  );

  const handleIncludeNoteContextChange = useCallback((checked: boolean) => {
    setIncludeNoteContext(checked);
    updateSetting("quickCommandIncludeNoteContext", checked);
  }, []);

  // Safely resolve the selected model with fallback to first enabled model
  const resolvedModel = useMemo((): CustomModel | null => {
    try {
      const model = findCustomModel(userSelectedModelKey, settings.activeModels);
      // Treat disabled models as invalid selections (ModelSelector won't present them)
      if (!model.enabled) {
        throw new Error(`Selected model is disabled: ${userSelectedModelKey}`);
      }
      return model;
    } catch {
      // Stale model key can happen when a model is removed/renamed/disabled; don't crash the modal.
      // Avoid side effects during render; notify/log in the effect below.
      return settings.activeModels.find((m) => m.enabled) ?? null;
    }
  }, [userSelectedModelKey, settings.activeModels]);

  // Compute the key for the resolved model
  const resolvedModelKey = useMemo(() => {
    if (!resolvedModel) return null;
    return `${resolvedModel.name}|${resolvedModel.provider}`;
  }, [resolvedModel]);

  // Effective model key for the UI — falls back to user selection when resolution fails.
  const effectiveModelKey = resolvedModelKey ?? userSelectedModelKey;

  // Use shared streaming hook
  const {
    isStreaming,
    streamingText,
    runTurn,
    stop: stopStreaming,
    getLatestStreamingText,
  } = useStreamingChatSession({
    model: resolvedModel,
    systemPrompt: systemPrompt || "",
    excludeThinking: true,
    onNoModel: () => {
      new Notice("No active model is configured. Please configure a model in Copilot settings.");
      setIsLoading(false);
    },
    onNonAbortError: (error) => {
      logError("Error generating response:", error);
      new Notice("Error generating response. Please try again.");
      setIsLoading(false);
    },
  });

  // Track the last input prompt for saving context on stop
  const lastInputPromptRef = useRef<string>("");

  // Sync editedText with finalText when finalText changes. Render-phase tracker
  // preserves user edits made after the last finalText change until the next change.
  const [prevFinalText, setPrevFinalText] = useState(finalText);
  if (prevFinalText !== finalText) {
    setPrevFinalText(finalText);
    if (finalText) {
      setEditedText(finalText);
    }
  }

  // Compute content state for MenuCommandModal
  const contentState: ContentState = useMemo(() => {
    if (isLoading && !isStreaming && !streamingText && !finalText) {
      return { type: "loading" };
    }
    if (isStreaming || streamingText) {
      return { type: "result", text: streamingText || finalText, isStreaming };
    }
    if (finalText) {
      return { type: "result", text: finalText, isStreaming: false };
    }
    return { type: "idle" };
  }, [isLoading, isStreaming, streamingText, finalText]);

  // Track if auto-execute has already run (prevent re-execution on model change)
  const didAutoExecuteRef = useRef(false);

  // Generate initial response (only for autoExecuteOnOpen mode)
  useEffect(() => {
    if (!behavior.autoExecuteOnOpen) return;
    // Only execute once - prevent re-execution when model changes
    if (didAutoExecuteRef.current) return;
    didAutoExecuteRef.current = true;

    let cancelled = false;

    async function generateInitialResponse() {
      try {
        const result = await runTurn(async (ctx: StreamingChatTurnContext) => {
          if (ctx.signal.aborted) return "";
          const prompt = await processCommandPrompt(command.content, originalText);
          lastInputPromptRef.current = prompt;
          return prompt;
        });

        if (!cancelled && result) {
          setFinalText(result);
          lastInputPromptRef.current = "";
        }
      } catch (error) {
        logError("Error in initial response:", error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void generateInitialResponse();

    return () => {
      cancelled = true;
      stopStreaming(ABORT_REASON.UNMOUNT);
    };
  }, [behavior.autoExecuteOnOpen, command.content, originalText, runTurn, stopStreaming]);

  const handleFollowUpSubmit = async () => {
    if (!followUpValue.trim()) return;

    // Prevent concurrent submissions
    if (followUpSubmitLockRef.current) return;
    if (isLoading || isStreaming) return;

    followUpSubmitLockRef.current = true;

    // Clear input and previous result immediately for responsive UI
    const inputValue = followUpValue;
    setFollowUpValue("");
    setFinalText("");
    setEditedText("");

    try {
      setIsLoading(true);

      const result = await runTurn(async (ctx: StreamingChatTurnContext) => {
        if (ctx.signal.aborted) return "";

        // Use ctx.isFirstTurn to determine if this is the first turn
        const isFirstTurn = ctx.isFirstTurn;

        // Apply first submit transform if provided (e.g., append note context placeholders)
        let rawInput = inputValue;
        if (isFirstTurn && behavior.firstSubmitTransform) {
          rawInput = behavior.firstSubmitTransform(rawInput, includeNoteContext);
        }

        // Process prompt (expand placeholders)
        const prompt = await processCommandPrompt(rawInput, originalText, !isFirstTurn);
        lastInputPromptRef.current = prompt;
        return prompt;
      });

      // Guard against unmount during async operation
      if (!isMountedRef.current) return;

      if (result) {
        setFinalText(result);
        lastInputPromptRef.current = "";
      }
    } catch (error) {
      // Handle errors in follow-up submit
      if (error instanceof Error && error.name === "AbortError") {
        // Silently ignore abort errors
      } else {
        logError("Error in follow-up submit:", error);
        if (isMountedRef.current) {
          new Notice("Failed to send message. Please try again.");
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      followUpSubmitLockRef.current = false;
    }
  };

  /**
   * Handle user stop action.
   * The shared hook handles memory persistence on USER_STOPPED automatically.
   * We only need to capture the latest text for UI display.
   */
  const handleStop = useCallback(() => {
    // Reason: Use getLatestStreamingText() to bypass RAF throttle,
    // ensuring we capture the most recent streamed content.
    const latestStreamedText = getLatestStreamingText().trim();

    stopStreaming(ABORT_REASON.USER_STOPPED);

    if (latestStreamedText) {
      setFinalText(latestStreamedText);
    }
    lastInputPromptRef.current = "";
  }, [stopStreaming, getLatestStreamingText]);

  const handleCopy = useCallback(async () => {
    const text = editedText || finalText || streamingText;
    if (!text) return;
    const cleaned = cleanMessageForCopy(text);
    try {
      await navigator.clipboard.writeText(cleaned);
      new Notice("Copied to clipboard");
    } catch {
      new Notice("Failed to copy to clipboard");
    }
  }, [editedText, finalText, streamingText]);

  const handleInsert = () => {
    const text = editedText || finalText || streamingText;
    if (text) onInsert(text);
  };

  const handleReplace = () => {
    const text = editedText || finalText || streamingText;
    if (text) onReplace(text);
  };

  return (
    <MenuCommandModal
      open={true}
      onClose={onClose}
      commandIcon={behavior.commandIcon}
      commandLabel={behavior.commandLabel}
      contentState={contentState}
      editableContent={editedText}
      onEditableContentChange={setEditedText}
      followUpValue={followUpValue}
      onFollowUpChange={setFollowUpValue}
      onFollowUpSubmit={handleFollowUpSubmit}
      selectedModel={effectiveModelKey}
      onSelectModel={handleModelChange}
      onStop={handleStop}
      onCopy={handleCopy}
      onInsert={handleInsert}
      onReplace={handleReplace}
      initialPosition={initialPosition}
      anchorBottom={anchorBottom}
      resizable
      hideContentAreaOnIdle={behavior.hideContentAreaOnIdle}
      includeNoteContext={behavior.showIncludeNoteContext ? includeNoteContext : undefined}
      onIncludeNoteContextChange={
        behavior.showIncludeNoteContext ? handleIncludeNoteContextChange : undefined
      }
      renderMarkdown={renderMarkdown}
    />
  );
}

// ============================================================================
// Modal Class
// ============================================================================

/**
 * Standalone floating modal for CustomCommandChat (not using Obsidian Modal).
 * This avoids the overlay issue caused by Obsidian's Modal class.
 * Positions itself near the cursor/selection like Quick Ask.
 */
export class CustomCommandChatModal {
  private root: Root | null = null;
  private container: HTMLElement | null = null;
  private highlightView: EditorView | null = null;
  private replaceGuard: ReplaceGuard | null = null;
  private scope: Scope | null = null;

  constructor(
    private app: App,
    private configs: {
      selectedText: string;
      command: CustomCommand;
      systemPrompt?: string;
      behaviorConfig?: Partial<ModalBehaviorConfig>;
    }
  ) {}

  /**
   * Resolve the correct window for a given view (or the active view).
   * Reason: In Obsidian popout windows, the global `window` refers to the main window,
   * but the editor lives in a different window. Using ownerDocument.defaultView ensures
   * the modal is positioned relative to the correct window.
   */
  private resolveWindow(view?: MarkdownView | null): Window {
    return view?.containerEl?.win ?? window;
  }

  /**
   * Resolve the correct document for a given view (or the active view).
   * Reason: Same multi-window concern as resolveWindow — the modal container must be
   * appended to the document that owns the triggering view.
   */
  private resolveDocument(view?: MarkdownView | null): Document {
    return view?.containerEl?.doc ?? activeDocument;
  }

  /**
   * Calculate initial position based on cursor/selection in the editor.
   * Strategy: vertical-first (determines placement), then horizontal (depends on placement).
   * - Multi-line selections always center horizontally on the editor.
   * - Space checks use scrollRect (editor visible area), not window.
   * - Horizontal clamp to scrollRect first, then viewport as safety net.
   */
  private getInitialPosition(activeView: MarkdownView | null): {
    x: number;
    y: number;
    anchorBottom?: number;
  } {
    const win = this.resolveWindow(activeView);
    const panelWidth = Math.min(500, win.innerWidth * 0.9);
    // Reason: The actual initial panel height depends on whether ContentArea is shown.
    // Quick Command starts idle with no ContentArea (compact).
    // Custom Commands always show ContentArea (expanded).
    // Using the correct height prevents gaps (above) or overlaps (below).
    const hideContentAreaOnIdle = this.configs.behaviorConfig?.hideContentAreaOnIdle ?? false;
    const panelHeight = hideContentAreaOnIdle
      ? MODAL_MIN_HEIGHT_COMPACT
      : MODAL_MIN_HEIGHT_EXPANDED;
    const margin = 12;
    const gap = 6;

    // Fallback: center on screen
    const fallback = {
      x: Math.max(margin, (win.innerWidth - panelWidth) / 2),
      y: Math.max(margin, (win.innerHeight - panelHeight) / 2),
    };

    if (!activeView?.editor?.cm) {
      return fallback;
    }

    const view = activeView.editor.cm;
    const selection = view.state.selection.main;
    const isCursor = selection.empty;

    // Reason: Dual-anchor model — compute separate top/bottom anchor positions.
    // bottomPos is used for "place below selection", topPos for "place above selection".
    // The shared utility handles the line-start trap correction.
    const anchors = computeSelectionAnchors(selection, view.state.doc);

    // Get coordinates for all anchor positions
    const focusCoords = view.coordsAtPos(anchors.focusPos);
    const bottomCoords = view.coordsAtPos(anchors.bottomPos);
    const topCoords = view.coordsAtPos(anchors.topPos);

    if (!focusCoords && !bottomCoords && !topCoords) {
      return fallback;
    }

    // Check visibility of each anchor against the editor's visible scroll area
    const scrollRect = view.scrollDOM.getBoundingClientRect();
    const isVisible = (coords: { top: number; bottom: number; left: number; right: number }) =>
      coords.bottom >= scrollRect.top &&
      coords.top <= scrollRect.bottom &&
      coords.right >= scrollRect.left &&
      coords.left <= scrollRect.right;

    const visibleFocus = focusCoords && isVisible(focusCoords) ? focusCoords : null;
    const visibleBottom = bottomCoords && isVisible(bottomCoords) ? bottomCoords : null;
    const visibleTop = topCoords && isVisible(topCoords) ? topCoords : null;

    if (!visibleFocus && !visibleBottom && !visibleTop) {
      return fallback;
    }

    // --- Visual multi-line detection ---
    // Reason: Using visual line height comparison instead of logical line numbers
    // correctly handles soft-wrapped lines that span multiple visual rows.
    const caretHeight = Math.min(
      (topCoords?.bottom ?? 0) - (topCoords?.top ?? 0),
      (bottomCoords?.bottom ?? 0) - (bottomCoords?.top ?? 0)
    );
    const isVisualMultiLine =
      !isCursor &&
      topCoords &&
      bottomCoords &&
      Math.abs(topCoords.top - bottomCoords.top) > Math.max(caretHeight / 2, 2);

    // --- Vertical positioning (decides placement first) ---
    // Reason: Extracted to a pure helper (computeVerticalPlacement) so the
    // branching logic is testable without DOM/CodeMirror dependencies.
    const { top: rawTop, anchorBottomY } = computeVerticalPlacement({
      scrollRect,
      visibleBottom,
      visibleTop,
      panelHeight,
      margin,
      gap,
      viewportHeight: win.innerHeight,
    });
    const top = rawTop;

    // --- Horizontal positioning (depends on vertical placement) ---
    let left: number;

    if (isCursor) {
      // Cursor: anchor at cursor position
      const anchor = visibleFocus ?? visibleBottom ?? visibleTop!;
      left = anchor.left;
    } else if (!isVisualMultiLine) {
      // Visual single-line: center panel on the selection span
      // Reason: Use normalized anchor positions instead of raw selection.from/to
      // to handle newline-at-end selections (line-start trap).
      const fromCoords = view.coordsAtPos(anchors.topPos);
      const toCoords = view.coordsAtPos(anchors.bottomPos);
      if (fromCoords && toCoords) {
        const centerX = (fromCoords.left + toCoords.right) / 2;
        left = centerX - panelWidth / 2;
      } else {
        // Coords unavailable — fall back to editor center
        left = (scrollRect.left + scrollRect.right) / 2 - panelWidth / 2;
      }
    } else {
      // Reason: Visual multi-line selections center on the editor regardless of
      // below/above/center placement, preventing left-edge snapping on reverse selections.
      left = (scrollRect.left + scrollRect.right) / 2 - panelWidth / 2;
    }

    // Clamp to editor visible area first, then viewport as safety net
    left = Math.max(scrollRect.left, Math.min(left, scrollRect.right - panelWidth));
    left = Math.max(margin, Math.min(left, win.innerWidth - margin - panelWidth));

    return { x: left, y: top, anchorBottom: anchorBottomY };
  }

  open() {
    // Reason: Push a Scope so user-bound global Cmd/Ctrl+Enter hotkeys don't fire
    // while this modal is open. The Scope handlers return true to consume the event;
    // the React onKeyDown inside MenuCommandModal does the actual Replace/Insert.
    this.scope = new Scope();
    this.scope.register(["Mod"], "Enter", () => true);
    this.scope.register(["Mod", "Shift"], "Enter", () => true);
    this.app.keymap.pushScope(this.scope);

    // Reason: Capture activeView once at open time to ensure document/window/editor
    // all reference the same view. Avoids subtle inconsistencies if the user switches
    // tabs between resolveDocument() and the selection snapshot below.
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

    const doc = this.resolveDocument(activeView);
    this.container = doc.createElement("div");
    this.container.className = "copilot-menu-command-modal-container";
    doc.body.appendChild(this.container);

    this.root = createRoot(this.container);

    // Capture ReplaceGuard (replaces captureReplaceSnapshot)
    const { selectedText, command, systemPrompt, behaviorConfig } = this.configs;
    let selectedTextSnapshot = selectedText;

    if (activeView?.editor?.cm) {
      const view = activeView.editor.cm;
      const selection = view.state.selection.main;
      const filePath = activeView.file?.path ?? null;
      selectedTextSnapshot = view.state.doc.sliceString(selection.from, selection.to);

      // Show persistent selection highlight
      SelectionHighlight.show(view, selection.from, selection.to);
      this.highlightView = view;

      // Create ReplaceGuard
      this.replaceGuard = createHighlightReplaceGuard({
        editorView: view,
        filePathSnapshot: filePath,
        selectedTextSnapshot,
        getCurrentContext: () => {
          const currentView = this.app.workspace.getActiveViewOfType(MarkdownView);
          return {
            editorView: currentView?.editor?.cm ?? null,
            filePath: currentView?.file?.path ?? null,
          };
        },
      });
    }

    const { anchorBottom, ...initialPosition } = this.getInitialPosition(activeView);

    const handleInsert = (message: string) => {
      void insertIntoEditor(message);
      this.close();
    };

    const handleReplace = (message: string) => {
      if (!this.replaceGuard) {
        new Notice("No selection to replace.");
        return;
      }

      const cleanedMessage = cleanMessageForCopy(message);
      const result = this.replaceGuard.replace(cleanedMessage);

      if (!result.ok) {
        new Notice(result.message ?? "Cannot replace.");
        return;
      }

      new Notice("Message replaced in the active note.");
      this.close();
    };

    const handleClose = () => {
      this.close();
    };

    this.root.render(
      <CustomCommandChatModalContent
        originalText={selectedTextSnapshot}
        command={command}
        onInsert={handleInsert}
        onReplace={handleReplace}
        onClose={handleClose}
        systemPrompt={systemPrompt}
        initialPosition={initialPosition}
        anchorBottom={anchorBottom}
        behaviorConfig={behaviorConfig}
      />
    );
  }

  close() {
    if (this.scope) {
      this.app.keymap.popScope(this.scope);
      this.scope = null;
    }
    // Hide selection highlight
    if (this.highlightView) {
      SelectionHighlight.hide(this.highlightView);
      this.highlightView = null;
    }
    // Clean up ReplaceGuard reference
    this.replaceGuard = null;
    this.root?.unmount();
    this.root = null;
    this.container?.remove();
    this.container = null;
  }
}
