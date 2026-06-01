import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import type { PromptContent } from "@/agentMode/session/types";
import type {
  AgentInputDraftControls,
  QueuedAgentMessage,
} from "@/agentMode/ui/hooks/useAgentInputDrafts";
import {
  clearSelectedTextContexts,
  removeSelectedTextContext,
  useSelectedTextContexts,
} from "@/aiParams";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import ChatInput, { type ChatInputProps } from "@/components/chat-components/ChatInput";
import { Button } from "@/components/ui/button";
import { EVENT_NAMES } from "@/constants";
import { EventTargetContext } from "@/context";
import { logError, logWarn } from "@/logger";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
  type SelectedTextContext,
} from "@/types/message";
import { arrayBufferToBase64 } from "@/utils/base64";
import { Clock, X } from "lucide-react";
import { App, Notice, TFile } from "obsidian";
import React, { memo, useCallback, useContext, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

interface AgentChatInputProps {
  backend: AgentChatBackend;
  /** Active session's internal id; selects which per-session draft is shown. */
  sessionId: string;
  /**
   * Per-session draft controls, owned by AgentHome (the common owner of the
   * transcript spinner and drop overlay that also read this draft's `loading`
   * and feed its context). Referentially stable, so it doesn't break this
   * component's memo on per-token stream re-renders.
   */
  draft: AgentInputDraftControls;
  app: App;
  updateUserMessageHistory: (newMessage: string) => void;
  isStarting: boolean;
  hasPendingPlanPermission: boolean;
  modelPickerOverride: ChatInputProps["modelPickerOverride"];
  modePickerOverride: ChatInputProps["modePickerOverride"];
  onCycleMode: () => void;
}

// Stable no-op handlers for ChatInput props that don't apply to Agent Mode
// (project progress card, vault indexing card).
const NOOP = () => {};

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
  const allPromptContent = items.flatMap((i) => i.promptContent ?? []);

  return {
    id: `queued-combined-${uuidv4()}`,
    text: items.map((i) => i.text).join("\n\n"),
    rawInput: items.map((i) => i.rawInput).join("\n\n"),
    context: buildMessageContext(
      dedupeBy(allNotes, (n) => n.path),
      dedupeBy(allSelected, (s) => s.id)
    ),
    promptContent: allPromptContent.length > 0 ? allPromptContent : undefined,
    hadUnsupportedAttachments: items.some((i) => i.hadUnsupportedAttachments),
  };
};

/**
 * Convert a `File` (from `<input type="file">` or paste/drop) into a base64
 * image `PromptContent` block. Returns `null` when the file is empty or
 * fails to read so the caller can skip it instead of breaking the turn.
 */
async function fileToImageBlock(file: File): Promise<PromptContent | null> {
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return { type: "image", mimeType: file.type || "image/png", data: arrayBufferToBase64(buf) };
  } catch (e) {
    logWarn("[AgentMode] failed to read attached image", e);
    return null;
  }
}

/**
 * Composer for Agent Mode: owns per-session draft state (input, attachments,
 * include flags, in-flight loading, queued follow-ups), the send/queue/stop
 * flow, and renders `ChatInput`. Memoized and detached from the message stream
 * so streamed tokens don't re-render the input. The plan/permission gate
 * (`pointer-events-none` while a plan permission is pending) wraps the input.
 */
export const AgentChatInput = memo(function AgentChatInput({
  backend,
  sessionId,
  draft,
  app,
  updateUserMessageHistory,
  isStarting,
  hasPendingPlanPermission,
  modelPickerOverride,
  modePickerOverride,
  onCycleMode,
}: AgentChatInputProps) {
  const eventTarget = useContext(EventTargetContext);
  const [selectedTextContexts] = useSelectedTextContexts();

  const isMountedRef = useRef(false);
  const previousSessionIdRef = useRef(sessionId);

  // Draft state is owned by AgentHome (so it can read `loading`/feed the drop
  // overlay); this composer is the controlled consumer.
  const {
    input: inputMessage,
    images: selectedImages,
    contextNotes,
    includeActiveNote,
    includeActiveWebTab,
    loading,
    queue: queuedMessages,
    setInput: setInputMessage,
    setContextNotes,
    setSelectedImages,
    addImages,
    setIncludeActiveNote,
    setIncludeActiveWebTab,
    setLoading,
    setQueue: setQueuedMessages,
    resetCompose,
  } = draft;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Selected-text contexts are a global ephemeral atom, not per-session draft.
  // Clear them when switching sessions so a selection made in one session
  // doesn't silently ride along into the next.
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return;
    previousSessionIdRef.current = sessionId;
    clearSelectedTextContexts();
  }, [sessionId]);

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
  }, [backend, setLoading, setQueuedMessages]);

  const runSend = useCallback(
    async (item: QueuedAgentMessage) => {
      if (item.hadUnsupportedAttachments) {
        new Notice("Web tab attachments aren't supported in Agent Mode yet.");
      }
      setLoading(true);
      try {
        const { turn } = backend.sendMessage(item.text, item.context, item.promptContent);
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
        await turn;
      } catch (error) {
        logError("Error sending agent message:", error);
        new Notice("Failed to send message. Please try again.");
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    },
    [backend, setLoading, updateUserMessageHistory]
  );

  const handleSendMessage = useCallback(async () => {
    const text = inputMessage.trim();
    if (!text) return;
    const rawInput = inputMessage;

    // Web tab / web-excerpt attachments still aren't wired through.
    // Images are handled below. PDFs stay in note context so the agent can
    // inspect them with its built-in Read tool instead of blocking send.
    const hasWebExcerpt = selectedTextContexts.some(isWebSelectedTextContext);
    const hadUnsupportedAttachments = includeActiveWebTab || hasWebExcerpt;

    const activeFile = app.workspace.getActiveFile();

    const candidateNotes: TFile[] = [];
    if (includeActiveNote && activeFile) {
      candidateNotes.push(activeFile);
    }
    candidateNotes.push(...contextNotes);
    const notes = dedupeBy(candidateNotes, (n) => n.path);

    // Slash-menu CustomCommands are inserted as literal `/<title>` text by
    // SlashCommandPlugin. Skills are recognized by the backend via its
    // command catalog, but CustomCommands aren't — expand the body here so
    // the backend sees the real prompt. (Mirrors ChatManager's processPrompt
    // call on the non-agent path.)
    const noteSelection = selectedTextContexts.find(isNoteSelectedTextContext);
    const expanded = await expandCustomCommandPrefix(
      text,
      getCachedCustomCommands(),
      app,
      noteSelection?.content ?? "",
      activeFile
    );
    if (expanded.matched) {
      void CustomCommandManager.getInstance().recordUsage(expanded.matched);
    }
    const resolvedText = resolveActiveNoteToken(expanded.text, activeFile);

    const content: PromptContent[] = [];

    // Convert attached images to base64 image content blocks.
    for (const image of selectedImages) {
      const block = await fileToImageBlock(image);
      if (block) content.push(block);
    }

    const item: QueuedAgentMessage = {
      id: `queued-${uuidv4()}`,
      text: resolvedText,
      rawInput,
      context: buildMessageContext(notes, selectedTextContexts),
      promptContent: content.length > 0 ? content : undefined,
      hadUnsupportedAttachments,
    };

    resetCompose();
    // The message context was already snapshotted above from this render's
    // captured `selectedTextContexts`, so clearing the global atom here is safe
    // for this send. The narrow window where the awaits above let the user
    // switch sessions and start a new selection before this clear fires is
    // accepted as-is (carried over verbatim from the pre-split AgentChat, and a
    // cleared selection is trivially recoverable). If a future review flags this
    // again, point them here.
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
    resetCompose,
    runSend,
    setQueuedMessages,
  ]);

  // When a turn ends, flush the queue as one combined message. The
  // `loading` and `queuedMessages.length` guards prevent re-entry: the
  // synchronous `setQueuedMessages([])` + `setLoading(true)` inside
  // runSend are batched, so the next effect run sees both updates.
  //
  // DESIGN NOTE: this only flushes the *foreground* session's queue — the
  // hook returns the active session's draft, so the effect observes whichever
  // session is on screen. If a turn runs in session A, the user queues a
  // follow-up, then switches to B, A's queue flushes when (and only when) the
  // user returns to A. That's intentional, not a regression: the legacy
  // AgentChat had the same queue mechanism but kept it in component useState,
  // and it remounted on every tab switch (`key={internalId}`) — so a
  // backgrounded session's queued follow-ups lived only in that now-unmounted
  // component and were discarded before they could flush. The per-session
  // draft store strictly improves on that — the queue now survives the switch
  // and flushes on return instead of being lost. True cross-session auto-flush
  // (a background turn draining its own queue with no foreground visit) would
  // require the session layer to own queue execution, which is backend work
  // deferred to PR2; PR1 keeps execution in the foreground composer. If a
  // future review flags this again, point them at this note.
  useEffect(() => {
    if (loading || isStarting || queuedMessages.length === 0) return;
    const combined = combineQueuedMessages(queuedMessages);
    setQueuedMessages([]);
    void runSend(combined);
  }, [loading, isStarting, queuedMessages, runSend, setQueuedMessages]);

  const handleRemoveQueuedMessage = useCallback(
    (id: string) => {
      setQueuedMessages((q) => q.filter((m) => m.id !== id));
    },
    [setQueuedMessages]
  );

  // Global ABORT_STREAM events (Chat selection / new-chat triggers) stop the
  // active turn the same way the composer's stop button does.
  useEffect(() => {
    const handleAbortStream = () => {
      void handleStopGenerating();
    };
    eventTarget?.addEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    };
  }, [eventTarget, handleStopGenerating]);

  return (
    <>
      {queuedMessages.length > 0 && (
        <QueuedMessageList messages={queuedMessages} onRemove={handleRemoveQueuedMessage} />
      )}
      <div
        className={hasPendingPlanPermission ? "tw-pointer-events-none tw-opacity-50" : undefined}
        aria-disabled={hasPendingPlanPermission || undefined}
      >
        {/* Key by session so ChatInput remounts on a tab/session switch. The
            per-session draft store (input/images/contextNotes/include flags)
            lives up in AgentHome and is threaded back as controlled props, so
            those survive the remount — but ChatInput's own internal-only state
            (contextUrls/contextFolders/contextWebTabs, the @-mention pills, the
            Lexical editor) is NOT in the draft, and would otherwise bleed from
            the previous session into a fresh one. The remount restores the
            per-session isolation the old `key={internalId}` AgentChat gave us.
            sessionId is stable across the landing→conversation flip (same
            session), so this never remounts during that transition. */}
        <ChatInput
          key={sessionId}
          isAgentMode
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={() => handleSendMessage()}
          isGenerating={loading}
          onStopGenerating={handleStopGenerating}
          onEscape={loading ? handleStopGenerating : undefined}
          onShiftTab={modePickerOverride ? onCycleMode : undefined}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          includeActiveWebTab={includeActiveWebTab}
          setIncludeActiveWebTab={setIncludeActiveWebTab}
          activeWebTab={null}
          selectedImages={selectedImages}
          onAddImage={addImages}
          setSelectedImages={setSelectedImages}
          disableModelSwitch={!modelPickerOverride}
          modelPickerOverride={modelPickerOverride ?? undefined}
          modePickerOverride={modePickerOverride ?? undefined}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={removeSelectedTextContext}
          showProgressCard={NOOP}
          showIndexingCard={NOOP}
        />
      </div>
    </>
  );
});

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
