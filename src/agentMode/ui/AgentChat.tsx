import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import ChatInput from "@/components/chat-components/ChatInput";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { EVENT_NAMES } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentChatMessage, CurrentPlan } from "@/agentMode/session/types";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import {
  clearSelectedTextContexts,
  removeSelectedTextContext,
  useSelectedTextContexts,
} from "@/aiParams";
import {
  isWebSelectedTextContext,
  type MessageContext,
  type SelectedTextContext,
} from "@/types/message";
import { Notice, TFile } from "obsidian";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Clock, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";

interface AgentChatProps {
  backend: AgentChatBackend;
  manager: AgentSessionManager;
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

// Stable no-op handlers for ChatInput props that don't apply to Agent Mode
// (project progress card, vault indexing card). Module-scoped so they don't
// create new function references on every AgentChat render.
const NOOP = () => {};

// Snapshotted at enqueue time so context (active note, selections) doesn't
// drift between when the user queues the message and when it actually flushes.
interface QueuedAgentMessage {
  id: string;
  text: string;
  rawInput: string;
  context?: MessageContext;
  hadUnsupportedAttachments: boolean;
}

const dedupeBy = <T,>(items: Iterable<T>, key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
};

const buildMessageContext = (
  notes: TFile[],
  selected: readonly SelectedTextContext[]
): MessageContext | undefined => {
  if (notes.length === 0 && selected.length === 0) return undefined;
  return {
    notes,
    urls: [],
    selectedTextContexts: selected.length > 0 ? [...selected] : undefined,
  };
};

const combineQueuedMessages = (items: QueuedAgentMessage[]): QueuedAgentMessage => {
  if (items.length === 1) return items[0];

  const allNotes = items.flatMap((i) => i.context?.notes ?? []);
  const allSelected = items.flatMap((i) => i.context?.selectedTextContexts ?? []);

  return {
    id: `queued-combined-${uuidv4()}`,
    text: items.map((i) => i.text).join("\n\n"),
    rawInput: items.map((i) => i.rawInput).join("\n\n"),
    context: buildMessageContext(
      dedupeBy(allNotes, (n) => n.path),
      dedupeBy(allSelected, (s) => s.id)
    ),
    hadUnsupportedAttachments: items.some((i) => i.hadUnsupportedAttachments),
  };
};

const AgentChatInternal: React.FC<AgentChatProps> = ({
  backend,
  manager,
  plugin,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  const eventTarget = useContext(EventTargetContext);
  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;

  const [messages, setMessages] = useState<AgentChatMessage[]>(() => backend.getMessages());
  const [inputMessage, setInputMessage] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [contextNotes, setContextNotes] = useState<TFile[]>([]);
  const [includeActiveNote, setIncludeActiveNote] = useState(false);
  const [includeActiveWebTab, setIncludeActiveWebTab] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(() => backend.isStarting());
  const [hasPendingPlanPermission, setHasPendingPlanPermission] = useState(() =>
    backend.hasPendingPlanPermission()
  );
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(() =>
    backend.getCurrentPlan()
  );
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedAgentMessage[]>([]);
  const [selectedTextContexts] = useSelectedTextContexts();

  const isMountedRef = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Subscribe to backend updates for re-renders.
  useEffect(() => {
    setMessages(backend.getMessages());
    setIsStarting(backend.isStarting());
    setHasPendingPlanPermission(backend.hasPendingPlanPermission());
    setCurrentPlan(backend.getCurrentPlan());
    return backend.subscribe(() => {
      if (!isMountedRef.current) return;
      setMessages(backend.getMessages());
      setIsStarting(backend.isStarting());
      setHasPendingPlanPermission(backend.hasPendingPlanPermission());
      setCurrentPlan(backend.getCurrentPlan());
    });
  }, [backend]);

  // Register a no-op save handler so CopilotView.saveChat() doesn't break.
  // Agent Mode persistence is not yet implemented.
  useEffect(() => {
    onSaveChat(async () => {
      // Intentionally a no-op: agent chat persistence is out of scope for Phase 2.
    });
  }, [onSaveChat]);

  const handleAddImage = useCallback(
    (files: File[]) => setSelectedImages((prev) => [...prev, ...files]),
    []
  );

  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes,
    setContextNotes,
    selectedImages,
    onAddImage: handleAddImage,
    containerRef: chatContainerRef,
  });

  const handleStopGenerating = useCallback(async () => {
    try {
      await backend.cancel();
    } catch (e) {
      logError("[AgentMode] cancel failed", e);
    }
    // Stop = user is bailing on the current turn; don't auto-flush queued
    // follow-ups they composed while the agent was running.
    setQueuedMessages([]);
    if (isMountedRef.current) setLoading(false);
  }, [backend]);

  const runSend = useCallback(
    async (item: QueuedAgentMessage) => {
      if (item.hadUnsupportedAttachments) {
        new Notice("Image and web attachments aren't supported in Agent Mode yet.");
      }
      setLoading(true);
      try {
        const { turn } = backend.sendMessage(item.text, item.context);
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
        await turn;
      } catch (error) {
        logError("Error sending agent message:", error);
        new Notice("Failed to send message. Please try again.");
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    },
    [backend, updateUserMessageHistory]
  );

  const handleSendMessage = useCallback(async () => {
    const text = inputMessage.trim();
    if (!text) return;
    const rawInput = inputMessage;

    // Image and web attachments aren't wired through ACP content blocks yet
    // (see buildPromptBlocks TODO in AgentSession.ts).
    const hasWebExcerpt = selectedTextContexts.some(isWebSelectedTextContext);
    const hadUnsupportedAttachments =
      selectedImages.length > 0 || includeActiveWebTab || hasWebExcerpt;

    const candidateNotes: TFile[] = [];
    if (includeActiveNote) {
      const active = app.workspace.getActiveFile();
      if (active) candidateNotes.push(active);
    }
    candidateNotes.push(...contextNotes);
    const notes = dedupeBy(candidateNotes, (n) => n.path);

    const item: QueuedAgentMessage = {
      id: `queued-${uuidv4()}`,
      text,
      rawInput,
      context: buildMessageContext(notes, selectedTextContexts),
      hadUnsupportedAttachments,
    };

    setInputMessage("");
    setSelectedImages([]);
    setContextNotes([]);
    setIncludeActiveNote(false);
    setIncludeActiveWebTab(false);
    clearSelectedTextContexts();

    if (loading || isStarting) {
      setQueuedMessages((q) => [...q, item]);
      return;
    }

    await runSend(item);
  }, [
    app,
    inputMessage,
    selectedImages,
    contextNotes,
    includeActiveNote,
    includeActiveWebTab,
    selectedTextContexts,
    loading,
    isStarting,
    runSend,
  ]);

  // When a turn ends, flush the queue as one combined message. The
  // `loading` and `queuedMessages.length` guards prevent re-entry: the
  // synchronous `setQueuedMessages([])` + `setLoading(true)` inside
  // runSend are batched, so the next effect run sees both updates.
  useEffect(() => {
    if (loading || isStarting || queuedMessages.length === 0) return;
    const combined = combineQueuedMessages(queuedMessages);
    setQueuedMessages([]);
    runSend(combined);
  }, [loading, isStarting, queuedMessages, runSend]);

  const handleRemoveQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((q) => q.filter((m) => m.id !== id));
  }, []);

  const handleNewChat = useCallback(() => {
    if (manager.getIsStarting()) return;
    const active = manager.getActiveSession();
    // Already on a fresh session — no-op so the user doesn't churn ACP
    // sessions just by clicking the button repeatedly.
    if (!active || !active.hasUserVisibleMessages()) return;
    const oldId = active.internalId;
    void (async () => {
      try {
        await manager.createSession();
        void manager
          .closeSession(oldId)
          .catch((e) => logError("[AgentMode] closeSession of old chat failed", e));
      } catch (e) {
        logError("[AgentMode] new chat failed", e);
        new Notice("Failed to start a new chat. Please try again.");
      }
    })();
    // selectedTextContexts is a global atom — clear it explicitly. (Local
    // input state is reset by AgentChat's `key={internalId}` remount.)
    clearSelectedTextContexts();
  }, [manager]);

  const handleDelete = useCallback(
    async (messageId: string) => {
      try {
        const ok = await backend.deleteMessage(messageId);
        if (!ok) new Notice("Failed to delete message. Please try again.");
      } catch (error) {
        logError("Error deleting agent message:", error);
        new Notice("Failed to delete message. Please try again.");
      }
    },
    [backend]
  );

  const descriptor = useSessionBackendDescriptor(manager);
  const handleInstall = useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  // Wrap an async action so a failure logs and surfaces a Notice consistently.
  // `rethrow` is on for callbacks the popover uses to revert inline edits
  // (rename, delete) and off for fire-and-forget loads.
  const runWithNotice = useCallback(
    async <T,>(label: string, action: () => Promise<T>, rethrow = false): Promise<T | void> => {
      try {
        return await action();
      } catch (error) {
        logError(`[AgentMode] ${label} failed`, error);
        new Notice(`Failed to ${label}.`);
        if (rethrow) throw error;
      }
    },
    []
  );

  const handleLoadChatHistory = useCallback(
    () =>
      runWithNotice("load chat history", async () => {
        const items = await manager.getChatHistoryItems();
        if (isMountedRef.current) setChatHistoryItems(items);
      }),
    [manager, runWithNotice]
  );

  const handleLoadChat = useCallback(
    (id: string) => runWithNotice("load chat", () => plugin.loadChatById(id)),
    [plugin, runWithNotice]
  );

  const handleUpdateChatTitle = useCallback(
    async (id: string, newTitle: string) => {
      await runWithNotice(
        "update chat title",
        async () => {
          await manager.updateChatTitle(id, newTitle);
          await handleLoadChatHistory();
        },
        true
      );
    },
    [manager, handleLoadChatHistory, runWithNotice]
  );

  const handleDeleteChat = useCallback(
    async (id: string) => {
      await runWithNotice(
        "delete chat",
        async () => {
          await manager.deleteChatHistory(id);
          await handleLoadChatHistory();
        },
        true
      );
    },
    [manager, handleLoadChatHistory, runWithNotice]
  );

  const handleOpenSourceFile = useCallback(
    (id: string) => runWithNotice("open chat source", () => plugin.openChatSourceFile(id)),
    [plugin, runWithNotice]
  );

  const modelPickerOverride = useAgentModelPicker(manager);
  const mode = modelPickerOverride?.mode;

  const handleCycleMode = useCallback(() => {
    if (!mode || mode.disabled || mode.options.length === 0) return;
    const currentIdx = mode.options.findIndex((o) => o.value === mode.value);
    const next = mode.options[(currentIdx + 1) % mode.options.length];
    if (next.value !== mode.value) mode.onChange(next.value);
  }, [mode]);

  // Listen to global ABORT_STREAM events (used by Chat selection / new-chat triggers)
  useEffect(() => {
    const handleAbortStream = () => {
      handleStopGenerating();
    };
    eventTarget?.addEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    };
  }, [eventTarget, handleStopGenerating]);

  return (
    <div ref={chatContainerRef} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-h-full">
        <div className="tw-relative tw-flex tw-h-full tw-flex-col">
          {isDragActive && (
            <div className="tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
              <span>Drop files here...</span>
            </div>
          )}
          <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
            <AgentModeStatus manager={manager} onInstallClick={handleInstall} />
            <AgentChatMessages
              messages={messages}
              app={app}
              onDelete={handleDelete}
              currentPlan={currentPlan}
              chatBackend={backend}
            />
            {queuedMessages.length > 0 && (
              <QueuedMessageList messages={queuedMessages} onRemove={handleRemoveQueuedMessage} />
            )}
            <AgentChatControls
              onNewChat={handleNewChat}
              chatHistoryItems={chatHistoryItems}
              onLoadHistory={handleLoadChatHistory}
              onLoadChat={handleLoadChat}
              onUpdateChatTitle={handleUpdateChatTitle}
              onDeleteChat={handleDeleteChat}
              onOpenSourceFile={handleOpenSourceFile}
            />
            <div
              className={
                hasPendingPlanPermission ? "tw-pointer-events-none tw-opacity-50" : undefined
              }
              aria-disabled={hasPendingPlanPermission || undefined}
            >
              <ChatInput
                inputMessage={inputMessage}
                setInputMessage={setInputMessage}
                handleSendMessage={() => handleSendMessage()}
                isGenerating={loading}
                onStopGenerating={handleStopGenerating}
                onEscape={loading ? handleStopGenerating : undefined}
                onShiftTab={mode ? handleCycleMode : undefined}
                app={app}
                contextNotes={contextNotes}
                setContextNotes={setContextNotes}
                includeActiveNote={includeActiveNote}
                setIncludeActiveNote={setIncludeActiveNote}
                includeActiveWebTab={includeActiveWebTab}
                setIncludeActiveWebTab={setIncludeActiveWebTab}
                activeWebTab={null}
                selectedImages={selectedImages}
                onAddImage={handleAddImage}
                setSelectedImages={setSelectedImages}
                disableModelSwitch={!modelPickerOverride}
                modelPickerOverride={modelPickerOverride ?? undefined}
                selectedTextContexts={selectedTextContexts}
                onRemoveSelectedText={removeSelectedTextContext}
                showProgressCard={NOOP}
                showIndexingCard={NOOP}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AgentChat: React.FC<AgentChatProps> = (props) => {
  return (
    <ChatInputProvider>
      <AgentChatInternal {...props} />
    </ChatInputProvider>
  );
};

interface QueuedMessageListProps {
  messages: QueuedAgentMessage[];
  onRemove: (id: string) => void;
}

const QueuedMessageList: React.FC<QueuedMessageListProps> = ({ messages, onRemove }) => {
  return (
    <div className="tw-flex tw-max-h-24 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-px-2 tw-pb-1">
      {messages.map((m) => (
        <div
          key={m.id}
          className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-rounded-md tw-bg-secondary-alt tw-px-2 tw-py-1 tw-text-ui-smaller"
          title={m.text}
        >
          <Clock className="tw-size-3 tw-shrink-0 tw-text-muted" />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-whitespace-nowrap tw-text-normal">
            {m.text}
          </span>
          <Button
            variant="ghost2"
            size="fit"
            className="tw-shrink-0 tw-text-muted hover:tw-text-error"
            onClick={() => onRemove(m.id)}
            aria-label="Remove queued message"
          >
            <X className="tw-size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
};

export default AgentChat;
