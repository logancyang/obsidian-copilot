import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { INSERT_TEXT_WITH_PILLS_COMMAND } from "@/components/chat-components/utils/lexicalTextUtils";
import type { WebTabContext } from "@/types/message";
import { LexicalEditor, type SerializedEditorState } from "lexical";

export interface ChatInputComposerSnapshot {
  editorState: SerializedEditorState | null;
  contextUrls: string[];
  contextFolders: string[];
  contextWebTabs: WebTabContext[];
}

export interface ChatInputComposerSnapshotBridge {
  capture(): ChatInputComposerSnapshot;
  restore(snapshot: ChatInputComposerSnapshot): void;
}

interface ChatInputContextType {
  insertTextWithPills: (text: string, enableURLPills?: boolean) => void;
  focusInput: () => void;
  registerEditor: (editor: LexicalEditor) => void;
  registerFocusHandler: (handler: () => void) => void;
  registerComposerSnapshotBridge: (bridge: ChatInputComposerSnapshotBridge) => () => void;
  preserveComposerAcrossNextMount: () => () => void;
}

const ChatInputContext = createContext<ChatInputContextType | undefined>(undefined);

/**
 * Hook to access chat input functionality
 */
export function useChatInput(): ChatInputContextType {
  const context = useContext(ChatInputContext);
  if (context === undefined) {
    throw new Error("useChatInput must be used within a ChatInputProvider");
  }
  return context;
}

interface ChatInputProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that manages chat input functionality without requiring refs
 */
export function ChatInputProvider({ children }: ChatInputProviderProps): JSX.Element {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const [focusHandler, setFocusHandler] = useState<(() => void) | null>(null);
  // Text requested before the Lexical editor has mounted (e.g. routed in while
  // the chat view is still opening). Held here and flushed once the editor
  // registers, so insertion never depends on mount timing.
  const pendingInsertRef = useRef<{ text: string; enableURLPills: boolean } | null>(null);
  // Focus requested before the Lexical editor registered its focus handler (e.g.
  // a freshly-opened view focusing on open). Latched here and flushed once the
  // handler registers, so focus never depends on mount timing.
  const pendingFocusRef = useRef(false);
  const composerSnapshotBridgeRef = useRef<ChatInputComposerSnapshotBridge | null>(null);
  const pendingComposerSnapshotRef = useRef<ChatInputComposerSnapshot | null>(null);

  const registerEditor = useCallback((editorInstance: LexicalEditor) => {
    setEditor(editorInstance);
  }, []);

  const registerFocusHandler = useCallback((handler: () => void) => {
    setFocusHandler(() => handler);
  }, []);

  /**
   * Register the currently mounted composer's snapshot adapter.
   * @param bridge - Captures and restores editor-owned composer state.
   */
  const registerComposerSnapshotBridge = useCallback((bridge: ChatInputComposerSnapshotBridge) => {
    composerSnapshotBridgeRef.current = bridge;
    // External sends on a fresh landing synchronously append their user
    // message, remounting ChatInput. Restore the old composer's complete state
    // as soon as the replacement registers.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
    if (pendingComposerSnapshotRef.current) {
      const snapshot = pendingComposerSnapshotRef.current;
      pendingComposerSnapshotRef.current = null;
      bridge.restore(snapshot);
    }
    return () => {
      composerSnapshotBridgeRef.current = null;
    };
  }, []);

  /** Capture the current composer for one expected remount and return a cancellation callback. */
  const preserveComposerAcrossNextMount = useCallback(() => {
    const bridge = composerSnapshotBridgeRef.current;
    // A request may race initial editor registration. Parent-owned draft fields
    // still survive; there is no mounted editor-owned state to snapshot yet.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
    pendingComposerSnapshotRef.current = bridge ? bridge.capture() : null;
    return () => {
      pendingComposerSnapshotRef.current = null;
    };
  }, []);

  const insertTextWithPills = useCallback(
    (text: string, enableURLPills = false) => {
      if (editor) {
        editor.dispatchCommand(INSERT_TEXT_WITH_PILLS_COMMAND, {
          text,
          options: { enableURLPills, insertAtSelection: true },
        });
      } else {
        pendingInsertRef.current = { text, enableURLPills };
      }
    },
    [editor]
  );

  // Flush any text buffered before the editor was ready.
  useEffect(() => {
    if (!editor || !pendingInsertRef.current) return;
    const { text, enableURLPills } = pendingInsertRef.current;
    pendingInsertRef.current = null;
    editor.dispatchCommand(INSERT_TEXT_WITH_PILLS_COMMAND, {
      text,
      options: { enableURLPills, insertAtSelection: true },
    });
  }, [editor]);

  const focusInput = useCallback(() => {
    if (focusHandler) {
      focusHandler();
    } else {
      pendingFocusRef.current = true;
    }
  }, [focusHandler]);

  // Flush a focus requested before the handler was ready.
  useEffect(() => {
    if (focusHandler && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      focusHandler();
    }
  }, [focusHandler]);

  const contextValue = useMemo<ChatInputContextType>(
    () => ({
      insertTextWithPills,
      focusInput,
      registerEditor,
      registerFocusHandler,
      registerComposerSnapshotBridge,
      preserveComposerAcrossNextMount,
    }),
    [
      insertTextWithPills,
      focusInput,
      registerEditor,
      registerFocusHandler,
      registerComposerSnapshotBridge,
      preserveComposerAcrossNextMount,
    ]
  );

  return <ChatInputContext.Provider value={contextValue}>{children}</ChatInputContext.Provider>;
}
