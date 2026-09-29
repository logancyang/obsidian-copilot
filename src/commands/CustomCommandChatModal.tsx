import { useModelKey } from "@/aiParams";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { MenuCommandModal, type ContentState } from "@/components/command-ui";
import { useApp } from "@/context";
import {
  MODAL_MIN_HEIGHT_COMPACT,
  MODAL_MIN_HEIGHT_EXPANDED,
} from "@/components/command-ui/constants";
import { SelectionHighlight } from "@/editor/selectionHighlight";
import { createHighlightReplaceGuard, type ReplaceGuard } from "@/editor/replaceGuard";
import { logError } from "@/logger";
import { cleanMessageForCopy, insertIntoEditor } from "@/utils";
import { useChatModelPicker } from "@/components/chat-components/useChatModelPicker";
import { useResolvedChatBackendModel } from "@/hooks/useResolvedChatBackendModel";
import { computeVerticalPlacement } from "@/utils/panelPlacement";
import { computeSelectionAnchors } from "@/utils/selectionAnchors";
import type { EditorView } from "@codemirror/view";
import { PenLine } from "lucide-react";
import { App, Component, MarkdownRenderer, Notice, MarkdownView, Scope } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preprocessAIResponse } from "@/utils/markdownPreprocess";
import { Root } from "react-dom/client";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { CustomCommand } from "@/commands/type";
import { useSettingsValue, updateSetting } from "@/settings/model";
import {
  useStreamingChatSession,
  type StreamingChatTurnContext,
} from "@/hooks/use-streaming-chat-session";
import { ABORT_REASON } from "@/constants";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export type ModelSelectionScope = "quick-command" | "custom-command";

export interface ModalBehaviorConfig {
  autoExecuteOnOpen: boolean;
  hideContentAreaOnIdle: boolean;
  firstSubmitTransform?: (input: string, includeNoteContext: boolean) => string;
  commandLabel: string;
  commandIcon?: React.ReactNode | null;
  showIncludeNoteContext?: boolean;
  modelSelectionScope?: ModelSelectionScope;
}

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

interface CustomCommandChatModalContentProps {
  originalText: string;
  command: CustomCommand;
  onInsert: (message: string) => void;
  onReplace: (message: string) => void;
  onClose: () => void;
  systemPrompt?: string;
  initialPosition?: { x: number; y: number };
  anchorBottom?: number;
  behaviorConfig?: Partial<ModalBehaviorConfig>;
}

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
  const app = useApp();
  const behavior = useMemo(
    () => resolveBehaviorConfig(command, behaviorConfig),
    [command, behaviorConfig]
  );

  const followUpSubmitLockRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const filePathSnapshotRef = useRef(app.workspace.getActiveFile()?.path ?? "");

  const renderMarkdown = useCallback(async (content: string, el: HTMLElement) => {
    const comp = obsidianComponentRef.current;
    if (!comp) return;
    const preprocessed = preprocessAIResponse(content);
    await MarkdownRenderer.renderMarkdown(preprocessed, el, filePathSnapshotRef.current, comp);
  }, []);

  const [finalText, setFinalText] = useState<string>("");
  const [editedText, setEditedText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(behavior.autoExecuteOnOpen);
  const [followUpValue, setFollowUpValue] = useState("");

  const [globalModelKey] = useModelKey();
  const settings = useSettingsValue();
  const modelSelectionScope = behavior.modelSelectionScope ?? "custom-command";

  const initialModelKey = useMemo(() => {
    if (modelSelectionScope === "quick-command") {
      return settings.quickCommandModelKey ?? globalModelKey;
    }
    return command.modelKey || globalModelKey;
  }, [modelSelectionScope, settings.quickCommandModelKey, command.modelKey, globalModelKey]);

  const [userSelectedModelKey, setUserSelectedModelKey] = useState(initialModelKey);

  const handleModelChange = useCallback(
    (newModelKey: string) => {
      setUserSelectedModelKey(newModelKey);
      if (modelSelectionScope === "quick-command") {
        updateSetting("quickCommandModelKey", newModelKey);
      }
    },
    [modelSelectionScope]
  );

  const [includeNoteContext, setIncludeNoteContext] = useState(
    () => settings.quickCommandIncludeNoteContext
  );

  const handleIncludeNoteContextChange = useCallback((checked: boolean) => {
    setIncludeNoteContext(checked);
    updateSetting("quickCommandIncludeNoteContext", checked);
  }, []);

  const resolvedModel = useResolvedChatBackendModel(app, userSelectedModelKey);

  const chatPicker = useChatModelPicker({
    value: userSelectedModelKey,
    onChange: handleModelChange,
  });

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

  const lastInputPromptRef = useRef<string>("");

  const [prevFinalText, setPrevFinalText] = useState(finalText);
  if (prevFinalText !== finalText) {
    setPrevFinalText(finalText);
    if (finalText) {
      setEditedText(finalText);
    }
  }

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

  const didAutoExecuteRef = useRef(false);

  useEffect(() => {
    if (!behavior.autoExecuteOnOpen) return;
    if (didAutoExecuteRef.current) return;
    didAutoExecuteRef.current = true;

    let cancelled = false;

    async function generateInitialResponse() {
      try {
        const result = await runTurn(async (ctx: StreamingChatTurnContext) => {
          if (ctx.signal.aborted) return "";
          const prompt = await processCommandPrompt(app, command.content, originalText);
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
  }, [app, behavior.autoExecuteOnOpen, command.content, originalText, runTurn, stopStreaming]);

  const handleFollowUpSubmit = async () => {
    if (!followUpValue.trim()) return;

    if (followUpSubmitLockRef.current) return;
    if (isLoading || isStreaming) return;

    followUpSubmitLockRef.current = true;

    const inputValue = followUpValue;
    setFollowUpValue("");
    setFinalText("");
    setEditedText("");

    try {
      setIsLoading(true);

      const result = await runTurn(async (ctx: StreamingChatTurnContext) => {
        if (ctx.signal.aborted) return "";

        const isFirstTurn = ctx.isFirstTurn;

        let rawInput = inputValue;
        if (isFirstTurn && behavior.firstSubmitTransform) {
          rawInput = behavior.firstSubmitTransform(rawInput, includeNoteContext);
        }

        const prompt = await processCommandPrompt(app, rawInput, originalText, !isFirstTurn);
        lastInputPromptRef.current = prompt;
        return prompt;
      });

      if (!isMountedRef.current) return;

      if (result) {
        setFinalText(result);
        lastInputPromptRef.current = "";
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
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

  const handleStop = useCallback(() => {
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
      onFollowUpSubmit={safeAsyncHandler(handleFollowUpSubmit)}
      selectedModel={chatPicker.value}
      onSelectModel={chatPicker.onChange}
      models={chatPicker.models}
      onStop={handleStop}
      onCopy={safeAsyncHandler(handleCopy)}
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

  private resolveWindow(view?: MarkdownView | null): Window {
    return view?.containerEl?.win ?? window;
  }

  private resolveDocument(view?: MarkdownView | null): Document {
    return view?.containerEl?.doc ?? activeDocument;
  }

  private getInitialPosition(activeView: MarkdownView | null): {
    x: number;
    y: number;
    anchorBottom?: number;
  } {
    const win = this.resolveWindow(activeView);
    const panelWidth = Math.min(500, win.innerWidth * 0.9);
    const hideContentAreaOnIdle = this.configs.behaviorConfig?.hideContentAreaOnIdle ?? false;
    const panelHeight = hideContentAreaOnIdle
      ? MODAL_MIN_HEIGHT_COMPACT
      : MODAL_MIN_HEIGHT_EXPANDED;
    const margin = 12;
    const gap = 6;

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

    const anchors = computeSelectionAnchors(selection, view.state.doc);

    const focusCoords = view.coordsAtPos(anchors.focusPos);
    const bottomCoords = view.coordsAtPos(anchors.bottomPos);
    const topCoords = view.coordsAtPos(anchors.topPos);

    if (!focusCoords && !bottomCoords && !topCoords) {
      return fallback;
    }

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

    const caretHeight = Math.min(
      (topCoords?.bottom ?? 0) - (topCoords?.top ?? 0),
      (bottomCoords?.bottom ?? 0) - (bottomCoords?.top ?? 0)
    );
    const isVisualMultiLine =
      !isCursor &&
      topCoords &&
      bottomCoords &&
      Math.abs(topCoords.top - bottomCoords.top) > Math.max(caretHeight / 2, 2);

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

    let left: number;

    if (isCursor) {
      const anchor = visibleFocus ?? visibleBottom ?? visibleTop!;
      left = anchor.left;
    } else if (!isVisualMultiLine) {
      const fromCoords = view.coordsAtPos(anchors.topPos);
      const toCoords = view.coordsAtPos(anchors.bottomPos);
      if (fromCoords && toCoords) {
        const centerX = (fromCoords.left + toCoords.right) / 2;
        left = centerX - panelWidth / 2;
      } else {
        left = (scrollRect.left + scrollRect.right) / 2 - panelWidth / 2;
      }
    } else {
      left = (scrollRect.left + scrollRect.right) / 2 - panelWidth / 2;
    }

    left = Math.max(scrollRect.left, Math.min(left, scrollRect.right - panelWidth));
    left = Math.max(margin, Math.min(left, win.innerWidth - margin - panelWidth));

    return { x: left, y: top, anchorBottom: anchorBottomY };
  }

  open() {
    this.scope = new Scope();
    this.scope.register(["Mod"], "Enter", () => true);
    this.scope.register(["Mod", "Shift"], "Enter", () => true);
    this.app.keymap.pushScope(this.scope);

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

    const doc = this.resolveDocument(activeView);
    this.container = doc.body.createDiv("copilot-menu-command-modal-container");

    this.root = createPluginRoot(this.container, this.app);

    const { selectedText, command, systemPrompt, behaviorConfig } = this.configs;
    let selectedTextSnapshot = selectedText;

    if (activeView?.editor?.cm) {
      const view = activeView.editor.cm;
      const selection = view.state.selection.main;
      const filePath = activeView.file?.path ?? null;
      selectedTextSnapshot = view.state.doc.sliceString(selection.from, selection.to);

      SelectionHighlight.show(view, selection.from, selection.to);
      this.highlightView = view;

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
      void insertIntoEditor(this.app, message);
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
    if (this.highlightView) {
      SelectionHighlight.hide(this.highlightView);
      this.highlightView = null;
    }
    this.replaceGuard = null;
    this.root?.unmount();
    this.root = null;
    this.container?.remove();
    this.container = null;
  }
}
