import { CustomModel, useModelKey } from "@/aiParams";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { MenuCommandModal, type ContentState } from "@/components/command-ui";
import { SelectionHighlight } from "@/editor/selectionHighlight";
import {
  createHighlightReplaceGuard,
  type ReplaceGuard,
} from "@/editor/replaceGuard";
import { logError, logWarn } from "@/logger";
import { cleanMessageForCopy, findCustomModel, insertIntoEditor } from "@/utils";
import type { EditorView } from "@codemirror/view";
import { PenLine } from "lucide-react";
import { App, Notice, MarkdownView } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const [selectedModelKey, setSelectedModelKey] = useState(initialModelKey);

  // Handle model change with scope-aware persistence
  const handleModelChange = useCallback(
    (newModelKey: string) => {
      setSelectedModelKey(newModelKey);
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

  // Track if we've already shown the fallback notice to avoid repeated notices
  const didShowFallbackNoticeRef = useRef(false);

  // Safely resolve the selected model with fallback to first enabled model
  const resolvedModel = useMemo((): CustomModel | null => {
    try {
      const model = findCustomModel(selectedModelKey, settings.activeModels);
      // Treat disabled models as invalid selections (ModelSelector won't present them)
      if (!model.enabled) {
        throw new Error(`Selected model is disabled: ${selectedModelKey}`);
      }
      return model;
    } catch {
      // Stale model key can happen when a model is removed/renamed/disabled; don't crash the modal.
      // Avoid side effects during render; notify/log in the effect below.
      return settings.activeModels.find((m) => m.enabled) ?? null;
    }
  }, [selectedModelKey, settings.activeModels]);

  // Compute the key for the resolved model
  const resolvedModelKey = useMemo(() => {
    if (!resolvedModel) return null;
    return `${resolvedModel.name}|${resolvedModel.provider}`;
  }, [resolvedModel]);

  // Update selectedModelKey if we had to fall back to a different model
  useEffect(() => {
    if (!resolvedModelKey) return;
    if (resolvedModelKey === selectedModelKey) return;

    // Always keep UI selection consistent with the resolved model
    setSelectedModelKey(resolvedModelKey);

    // Notify only once per modal lifecycle
    if (didShowFallbackNoticeRef.current) return;
    didShowFallbackNoticeRef.current = true;
    logWarn("Selected model is no longer available. Falling back to a default model.", {
      selectedModelKey,
      resolvedModelKey,
    });
    new Notice("Selected model is no longer available. Falling back to a default model.");
  }, [resolvedModelKey, selectedModelKey]);

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

  // Sync editedText with finalText when finalText changes
  useEffect(() => {
    if (finalText) {
      setEditedText(finalText);
    }
  }, [finalText]);

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

    generateInitialResponse();

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
      selectedText={originalText}
      contentState={contentState}
      editableContent={editedText}
      onEditableContentChange={setEditedText}
      followUpValue={followUpValue}
      onFollowUpChange={setFollowUpValue}
      onFollowUpSubmit={handleFollowUpSubmit}
      selectedModel={selectedModelKey}
      onSelectModel={handleModelChange}
      onStop={handleStop}
      onInsert={handleInsert}
      onReplace={handleReplace}
      initialPosition={initialPosition}
      resizable
      hideContentAreaOnIdle={behavior.hideContentAreaOnIdle}
      includeNoteContext={behavior.showIncludeNoteContext ? includeNoteContext : undefined}
      onIncludeNoteContextChange={
        behavior.showIncludeNoteContext ? handleIncludeNoteContextChange : undefined
      }
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
    return view?.containerEl?.ownerDocument?.defaultView ?? window;
  }

  /**
   * Resolve the correct document for a given view (or the active view).
   * Reason: Same multi-window concern as resolveWindow — the modal container must be
   * appended to the document that owns the triggering view.
   */
  private resolveDocument(view?: MarkdownView | null): Document {
    return view?.containerEl?.ownerDocument ?? document;
  }

  /**
   * Calculate initial position based on cursor/selection in the editor.
   * Handles: single-line, multi-line, line-start trap, flip when near bottom edge.
   */
  private getInitialPosition(activeView: MarkdownView | null): { x: number; y: number } {
    const win = this.resolveWindow(activeView);
    const panelWidth = Math.min(500, win.innerWidth * 0.9);
    const panelHeight = 440;
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

    // Reason: Use `head` (where user's cursor is) instead of `to`, so that
    // reverse selections still position the popup near the user's focus point.
    let anchorPos = selection.head;

    // Fix "line-start trap": when head lands on next line's start after selecting newline
    // Reason: Only apply when head is at the END of selection (head === to), not when
    // user reverse-selects TO a line start (head === from). This avoids jumping to
    // previous line when user intentionally selects to line beginning.
    if (!isCursor && anchorPos > 0 && anchorPos === selection.to) {
      const lineAtHead = view.state.doc.lineAt(anchorPos);
      if (anchorPos === lineAtHead.from) {
        // Head is at line start and is the selection end, move back to previous line's end
        anchorPos = anchorPos - 1;
      }
    }

    // Get coordinates for anchor position
    const anchorCoords = view.coordsAtPos(anchorPos);
    if (!anchorCoords) {
      return fallback;
    }

    // Check visibility (both vertical and horizontal)
    const scrollRect = view.scrollDOM.getBoundingClientRect();
    const isVerticallyVisible =
      anchorCoords.bottom >= scrollRect.top && anchorCoords.top <= scrollRect.bottom;
    const isHorizontallyVisible =
      anchorCoords.right >= scrollRect.left && anchorCoords.left <= scrollRect.right;

    if (!isVerticallyVisible || !isHorizontallyVisible) {
      return fallback;
    }

    // Calculate horizontal position
    let centerX: number;
    if (isCursor) {
      // Cursor only: position near cursor (not centered, to avoid obscuring)
      centerX = anchorCoords.left;
    } else {
      // Selection: check if single-line or multi-line
      const lineAtFrom = view.state.doc.lineAt(selection.from);
      const lineAtTo = view.state.doc.lineAt(selection.to);

      if (lineAtFrom.number === lineAtTo.number) {
        // Single-line: center between from and to
        const fromCoords = view.coordsAtPos(selection.from);
        const toCoords = view.coordsAtPos(selection.to);
        if (fromCoords && toCoords) {
          centerX = (fromCoords.left + toCoords.right) / 2;
        } else {
          centerX = anchorCoords.left;
        }
      } else {
        // Multi-line: follow the anchor (head) position
        centerX = anchorCoords.left;
      }
    }

    // Calculate left position
    // For cursor: align left edge near cursor; for selection: center the panel
    let left: number;
    if (isCursor) {
      left = centerX;
    } else {
      left = centerX - panelWidth / 2;
    }
    left = Math.max(margin, Math.min(left, win.innerWidth - margin - panelWidth));

    // Calculate vertical position with flip logic
    const anchorBottom = anchorCoords.bottom;
    const anchorTop = anchorCoords.top;
    const spaceBelow = win.innerHeight - anchorBottom - gap;
    const spaceAbove = anchorTop - gap;

    let top: number;
    if (spaceBelow >= panelHeight + margin) {
      // Enough space below: place below anchor
      top = anchorBottom + gap;
    } else if (spaceAbove >= panelHeight + margin) {
      // Not enough below but enough above: flip to above
      top = anchorTop - gap - panelHeight;
    } else {
      // Neither side has enough space: prefer the side with more space
      if (spaceBelow >= spaceAbove) {
        top = anchorBottom + gap;
      } else {
        top = anchorTop - gap - panelHeight;
      }
    }

    // Final clamp to ensure panel stays within viewport
    top = Math.max(margin, Math.min(top, win.innerHeight - margin - panelHeight));

    return { x: left, y: top };
  }

  open() {
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

    const initialPosition = this.getInitialPosition(activeView);

    const handleInsert = (message: string) => {
      insertIntoEditor(message);
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
        behaviorConfig={behaviorConfig}
      />
    );
  }

  close() {
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
