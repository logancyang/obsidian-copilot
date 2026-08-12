import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import type { PromptContent } from "@/agentMode/session/types";
import {
  AGENT_COMPOSER_PLACEHOLDER,
  AGENT_PROMPT_SUGGESTIONS,
} from "@/agentMode/ui/agentPromptSuggestions";
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
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { Button } from "@/components/ui/button";
import { ACTIVE_WEB_TAB_MARKER, EVENT_NAMES } from "@/constants";
import { cn } from "@/lib/utils";
import { useCanUseMultiAgent } from "@/plusUtils";
import { EventTargetContext } from "@/context";
import { logError, logWarn } from "@/logger";
import {
  isFanout,
  resolveAnswerers,
  useInstalledAgentBrands,
} from "@/agentMode/ui/mentionedAgents";
import type { BackendId } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { getCloudAgentIds } from "@/agentMode/backends/registry";
import { buildWebTabsWithActiveSnapshot } from "@/services/webViewerService/activeWebTabSnapshot";
import {
  isNoteSelectedTextContext,
  type MessageContext,
  type SelectedTextContext,
  type WebTabContext,
} from "@/types/message";
import { getModelKeyFromModel } from "@/settings/model";
import { modelSupportsVision } from "@/utils";
import { arrayBufferToBase64 } from "@/utils/base64";
import { mergeWebTabContexts } from "@/utils/urlNormalization";
import { Clock, X } from "lucide-react";
import { App, Notice, TFile } from "obsidian";
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentChatInputProps {
  backend: AgentChatBackend;
  /** Plugin instance — descriptors need it to observe backend readiness changes. */
  plugin: CopilotPlugin;
  /** Identity of the logical chat input whose UI state this component owns. */
  chatInputId: string;
  /**
   * Per-session draft controls, owned by AgentHome (the common owner of the
   * transcript spinner and drop overlay that also read this draft's `loading`
   * and feed its context). Referentially stable, so it doesn't break this
   * component's memo on per-token stream re-renders.
   */
  draft: AgentInputDraftControls;
  app: App;
  /**
   * The session's main agent (the summarizer). Used by `isFanout` to collapse the
   * degenerate `[main]` selection to the single-agent path. `null` before a session lands.
   */
  mainAgentId: BackendId | null;
  updateUserMessageHistory: (newMessage: string) => void;
  isStarting: boolean;
  hasPendingPlanPermission: boolean;
  modelPickerOverride: ChatInputProps["modelPickerOverride"];
  modePickerOverride: ChatInputProps["modePickerOverride"];
  onCycleMode: () => void;
  /**
   * Active scope ({@link GLOBAL_SCOPE} or a project id). Gates the
   * context-load hold below to real projects; `GLOBAL_SCOPE` never holds.
   */
  activeProjectId?: string;
  /**
   * The active project's context is still materializing (read by the parent from
   * `agentProjectContextLoadAtom[projectId].blocking`). Send stays clickable but
   * **queues** instead of firing, then auto-flushes when the load clears —
   * queue-and-hold, never a hard-disabled button.
   */
  contextLoadBlocking?: boolean;
  /**
   * Hard-disable the whole composer (pointer-events + dim), e.g. the active
   * project was deleted out from under the user. Distinct from
   * {@link contextLoadBlocking}, which only defers sends.
   */
  disabled?: boolean;
  /**
   * Agent project-context status icon, rendered through ChatInput's
   * top-right accessory column (see the DESIGN NOTE at the mount point).
   */
  contextStatusIndicator?: React.ReactNode;
  /**
   * This session has no user-visible messages yet. Gates the rotating sample
   * prompts to the landing — the one surface where they showcase rather than
   * distract.
   */
  isLanding?: boolean;
}

// Stable no-op handler for required ChatInput props that don't apply to
// Agent Mode (project progress card). Optional props with no Agent Mode
// surface (e.g. showIndexingCard) are omitted instead, so their `&& prop`
// render guards stay effective.
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
  selected: readonly SelectedTextContext[],
  webTabs: readonly WebTabContext[] = []
): MessageContext | undefined => {
  if (notes.length === 0 && selected.length === 0 && webTabs.length === 0) return undefined;
  return {
    notes,
    urls: [],
    selectedTextContexts: selected.length > 0 ? [...selected] : undefined,
    webTabs: webTabs.length > 0 ? [...webTabs] : undefined,
  };
};

const combineQueuedMessages = (items: QueuedAgentMessage[]): QueuedAgentMessage => {
  if (items.length === 1) return items[0];

  const allNotes = items.flatMap((i) => i.context?.notes ?? []);
  const allSelected = items.flatMap((i) => i.context?.selectedTextContexts ?? []);
  const allWebTabs = items.flatMap((i) => i.context?.webTabs ?? []);
  const allPromptContent = items.flatMap((i) => i.promptContent ?? []);
  // Union the per-message answerer selections, preserving first-seen order.
  const mergedAgents = dedupeBy(
    items.flatMap((i) => i.mentionedAgents ?? []),
    (id) => id
  );

  return {
    id: `queued-combined-${uuidv4()}`,
    text: items.map((i) => i.text).join("\n\n"),
    rawInput: items.map((i) => i.rawInput).join("\n\n"),
    context: buildMessageContext(
      dedupeBy(allNotes, (n) => n.path),
      dedupeBy(allSelected, (s) => s.id),
      mergeWebTabContexts(allWebTabs)
    ),
    promptContent: allPromptContent.length > 0 ? allPromptContent : undefined,
    mentionedAgents: mergedAgents.length > 0 ? mergedAgents : undefined,
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
 * Composer for Agent Mode: consumes per-chat-input draft state (input,
 * attachments, include flags, in-flight loading, queued follow-ups), owns the
 * send/queue/stop flow, and renders `ChatInput`. Memoized and detached from the message stream
 * so streamed tokens don't re-render the input. The plan/permission gate
 * (`pointer-events-none` while a plan permission is pending) wraps the input.
 */
export const AgentChatInput = memo(function AgentChatInput({
  backend,
  plugin,
  chatInputId,
  draft,
  app,
  mainAgentId,
  updateUserMessageHistory,
  isStarting,
  hasPendingPlanPermission,
  modelPickerOverride,
  modePickerOverride,
  onCycleMode,
  activeProjectId,
  contextLoadBlocking = false,
  disabled = false,
  contextStatusIndicator,
  isLanding = false,
}: AgentChatInputProps) {
  const eventTarget = useContext(EventTargetContext);

  // Hold sends only while a *real* project's context is materializing. Global
  // scope never holds, so the global landing's send path is byte-identical.
  const holdForContext =
    contextLoadBlocking && !!activeProjectId && activeProjectId !== GLOBAL_SCOPE;
  const [selectedTextContexts] = useSelectedTextContexts();
  // SSoT for the Active Web Tab; `activeWebTabForMentions` matches the send
  // snapshot (preserved only when focusing the chat panel). Drives the
  // ChatInput "Active Web Tab" affordance and is resolved into the outgoing
  // webTabs at send time below.
  const { activeWebTabForMentions } = useActiveWebTabState();

  const previousChatInputIdRef = useRef(chatInputId);

  // The `@agent` typeahead group + pills are paid-only. Reactive so a settings
  // change flips the gate live; the authoritative send-time check is separate.
  const canUseMultiAgent = useCanUseMultiAgent();

  // Installed agents the user can `@`-mention; tracks settings *and* async
  // readiness (compatibility probes settle without a settings write).
  const installedAgentBrands = useInstalledAgentBrands(plugin);
  // Entitlement-gated typeahead list: free users get the frozen empty list so the
  // "Agents" group never renders. Both operands are stable refs (no memo needed).
  const agentBrands = canUseMultiAgent ? installedAgentBrands : EMPTY_AGENT_MENTION_BRANDS;
  // The send-time allowlist is the REAL installed set, INDEPENDENT of the gated
  // typeahead list: a pasted pill (or a stale-false cache) must still resolve to a
  // real answerer so the turn fans out and hits the authoritative entitlement check.
  const installedAgentIds = useMemo(
    () => new Set(installedAgentBrands.map((b) => b.id)),
    [installedAgentBrands]
  );
  // Held in a ref (not state) so a mention edit never re-renders mid-stream; read at send time.
  const mentionedAgentIdsRef = useRef<string[]>([]);
  const handleMentionedAgentsChange = useCallback((backendIds: string[]) => {
    mentionedAgentIdsRef.current = backendIds;
  }, []);

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
  const activeModelEntry = modelPickerOverride?.models.find(
    (model) => getModelKeyFromModel(model) === modelPickerOverride.value
  );
  const unsupportedImageModelLabel =
    Array.isArray(activeModelEntry?.capabilities) && !modelSupportsVision(activeModelEntry)
      ? activeModelEntry.displayName || activeModelEntry.name
      : null;

  // Clear input-scoped ephemeral state when the logical chat input changes: the global
  // selected-text atom and the mentioned-agent ref (neither is reset by the
  // editor remount), so a selection or `@agent` pill can't ride into the next input.
  useEffect(() => {
    if (previousChatInputIdRef.current === chatInputId) return;
    previousChatInputIdRef.current = chatInputId;
    clearSelectedTextContexts();
    mentionedAgentIdsRef.current = [];
  }, [chatInputId]);

  const handleStopGenerating = useCallback(async () => {
    try {
      await backend.cancel();
    } catch (e) {
      logError("[AgentMode] cancel failed", e);
    }
    // Stop = user is bailing on the current turn; don't auto-flush queued
    // follow-ups they composed while the agent was running.
    setQueuedMessages([]);
    setLoading(false);
  }, [backend, setLoading, setQueuedMessages]);

  const runSend = useCallback(
    async (item: QueuedAgentMessage) => {
      setLoading(true);
      try {
        const { turn } = backend.sendMessage(
          item.text,
          item.context,
          item.promptContent,
          item.mentionedAgents
        );
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
        await turn;
      } catch (error) {
        logError("Error sending agent message:", error);
        new Notice("Failed to send message. Please try again.");
      } finally {
        // No mounted guard here: this composer remounts on the
        // landing→conversation flip (AgentHome renders it at different tree
        // positions), which happens DURING the first turn of every session —
        // the unmounting instance must still clear the in-flight flag.
        // `setLoading` writes AgentHome's per-chat-input draft store (not local
        // state), so calling it after unmount is safe, and the store itself
        // drops updates for chat inputs that are no longer live.
        setLoading(false);
      }
    },
    [backend, setLoading, updateUserMessageHistory]
  );

  const handleSendMessage = useCallback(
    async (webTabs?: WebTabContext[]) => {
      // A hard-disabled composer (e.g. an orphaned project) must not send. The
      // wrapper only blocks pointer events + dims, so a focused editor could
      // otherwise submit a turn via the keyboard; bail before any prep work.
      if (disabled) return;
      const text = inputMessage.trim();
      if (!text) return;
      const rawInput = inputMessage;

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
        noteSelection?.content ?? "",
        activeFile
      );
      if (expanded.matched) {
        void CustomCommandManager.getInstance().recordUsage(expanded.matched);
      }
      const resolvedText = resolveActiveNoteToken(expanded.text, activeFile);

      // Resolve the Active Web Tab into the outgoing webTabs (snapshot at send
      // time). Mirrors ChatManager: any text selection suppresses the active
      // tab to avoid redundant context.
      const hasAnySelection = selectedTextContexts.length > 0;
      const shouldIncludeActiveWebTab =
        !hasAnySelection && (includeActiveWebTab || resolvedText.includes(ACTIVE_WEB_TAB_MARKER));
      const resolvedWebTabs = buildWebTabsWithActiveSnapshot(
        app,
        webTabs ?? [],
        shouldIncludeActiveWebTab
      );

      // Hard-block sending images to a model that is KNOWN to lack vision. We
      // only block when the active entry's capabilities are populated (an empty
      // array still means "known"); undefined means "unknown" and must not
      // block. An undefined `modelPickerOverride` (model switching disabled) can't
      // resolve an active entry, so it's also treated as unknown. Inputs are left
      // intact (guard precedes resetCompose) so the user can switch models.
      if (selectedImages.length > 0 && unsupportedImageModelLabel) {
        new Notice(
          `${unsupportedImageModelLabel} doesn't support images. Switch to a vision-capable model to send images.`
        );
        return;
      }

      // Resolve the `@`-mentions into the ANSWERER set (installed, deduped). Only
      // carried when it actually fans out; the single-agent path sends no
      // `mentionedAgents` and stays byte-for-byte the existing behavior. Read the
      // mention ref before resetCompose clears it below.
      let mentionedAgents: ReadonlyArray<BackendId> | undefined;
      if (mainAgentId) {
        const answerers = resolveAnswerers({
          mentionedAgentIds: mentionedAgentIdsRef.current,
          installedAgentIds,
        });
        if (isFanout(answerers, mainAgentId)) mentionedAgents = answerers;
      }

      // Clear the composer NOW, before the async image reads below, so it empties
      // the instant the user sends instead of after every attached image finishes
      // decoding. `selectedImages` is already captured in this closure, so the
      // conversion still runs on the snapshot. (The stale-text-left-behind race in
      // #211 is closed at its source by `ignoreSelectionChange` on the editor's
      // OnChangePlugin; clearing before the awaits additionally shrinks the window
      // the draft stays populated, but is not what fixes the race.)
      mentionedAgentIdsRef.current = [];
      resetCompose();
      // The message context is built below from this render's captured
      // `selectedTextContexts` (a closure value the atom clear doesn't touch), so
      // clearing the global atom here is safe for this send. The narrow window where
      // the awaits below let the user switch sessions and start a new selection
      // before this clear fires is accepted as-is (carried over verbatim from the
      // pre-split AgentChat, and a cleared selection is trivially recoverable). If a
      // future review flags this again, point them here.
      clearSelectedTextContexts();

      // Convert the attached images to base64 image content blocks.
      const content: PromptContent[] = [];
      for (const image of selectedImages) {
        const block = await fileToImageBlock(image);
        if (block) content.push(block);
      }

      const item: QueuedAgentMessage = {
        id: `queued-${uuidv4()}`,
        text: resolvedText,
        rawInput,
        context: buildMessageContext(notes, selectedTextContexts, resolvedWebTabs),
        promptContent: content.length > 0 ? content : undefined,
        mentionedAgents,
      };

      // Queue-and-hold: while a turn is in flight, starting, or the project's
      // context is still materializing, park the message instead of sending.
      // The flush effect below drains it once all three clear. Context-held
      // rows get an amber "Waiting for context" label; the reason is an
      // enqueue-time snapshot, not re-derived as blockers evolve.
      if (loading || isStarting || holdForContext) {
        setQueuedMessages((q) => [
          ...q,
          { ...item, queueReason: holdForContext ? "context" : "busy" },
        ]);
        return;
      }

      await runSend(item);
    },
    [
      app,
      inputMessage,
      selectedImages,
      contextNotes,
      includeActiveNote,
      includeActiveWebTab,
      selectedTextContexts,
      loading,
      isStarting,
      unsupportedImageModelLabel,
      holdForContext,
      disabled,
      resetCompose,
      runSend,
      setQueuedMessages,
      mainAgentId,
      installedAgentIds,
    ]
  );

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
    // `disabled` guards the same hard-disable as the send path: a project
    // orphaned while messages are queued must not drain its queue into a
    // disabled composer.
    if (disabled || loading || isStarting || holdForContext || queuedMessages.length === 0) return;
    const combined = combineQueuedMessages(queuedMessages);
    if (
      combined.promptContent?.some((content) => content.type === "image") &&
      unsupportedImageModelLabel
    ) {
      new Notice(
        `${unsupportedImageModelLabel} doesn't support images. Switch to a vision-capable model to send images.`
      );
      return;
    }
    setQueuedMessages([]);
    void runSend(combined);
  }, [
    disabled,
    loading,
    isStarting,
    holdForContext,
    queuedMessages,
    runSend,
    setQueuedMessages,
    unsupportedImageModelLabel,
  ]);

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
        className={
          hasPendingPlanPermission || disabled ? "tw-pointer-events-none tw-opacity-50" : undefined
        }
        aria-disabled={hasPendingPlanPermission || disabled || undefined}
      >
        {/* DESIGN NOTE: the project-context status trigger renders through
            ChatInput's structural top-right accessory column — a real layout
            column, not an overlay — so badges, images, placeholder, and
            editor text stay clear of it without avoidance padding (up to the
            column's small deliberate negative-margin overlap, documented at
            the ChatInput mount point). One mount point, no layout jump
            when badges appear. Moving it into the bottom control row was
            considered and rejected (the corner is the established home for
            this status, and it should read as context state for the whole
            composer, not a send control); an absolute overlay was rejected
            because every content type would then need its own avoidance
            padding — an open-ended maintenance obligation (#205). If a
            future review flags either choice again, point them at this
            note. */}
        {/* Key by logical chat input so ChatInput remounts on a tab/New Chat switch. The
            per-session draft store (input/images/contextNotes/include flags)
            lives up in AgentHome and is threaded back as controlled props, so
            those survive the remount — but ChatInput's own internal-only state
            (contextUrls/contextFolders/contextWebTabs, the @-mention pills, the
            Lexical editor) is NOT in the draft, and would otherwise bleed from
            the previous session into a fresh one. The remount restores the
            input isolation the old `key={internalId}` AgentChat gave us.
            chatInputId also stays stable when only the backend runtime is
            replaced, so that transition preserves editor-owned state. */}
        <ChatInput
          key={chatInputId}
          isAgentMode
          placeholder={AGENT_COMPOSER_PLACEHOLDER}
          // Whether the composer is empty is not this component's business:
          // the placeholder slot only exists while it is, so a landing can
          // offer suggestions unconditionally and get "gone while they type,
          // back once they clear it" for free.
          placeholderPrompts={isLanding ? AGENT_PROMPT_SUGGESTIONS : undefined}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={safeAsyncHandler((meta) => handleSendMessage(meta?.webTabs))}
          isGenerating={loading}
          onStopGenerating={safeAsyncHandler(handleStopGenerating)}
          onEscape={loading ? safeAsyncHandler(handleStopGenerating) : undefined}
          onShiftTab={modePickerOverride ? onCycleMode : undefined}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          includeActiveWebTab={includeActiveWebTab}
          setIncludeActiveWebTab={setIncludeActiveWebTab}
          activeWebTab={activeWebTabForMentions}
          selectedImages={selectedImages}
          onAddImage={addImages}
          setSelectedImages={setSelectedImages}
          disableModelSwitch={!modelPickerOverride}
          modelPickerOverride={modelPickerOverride ?? undefined}
          modePickerOverride={modePickerOverride ?? undefined}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={removeSelectedTextContext}
          agentBrands={agentBrands}
          cloudAgentIds={getCloudAgentIds()}
          onMentionedAgentsChange={handleMentionedAgentsChange}
          showProgressCard={NOOP}
          // showIndexingCard is deliberately NOT passed: the vault-indexing
          // chip is not an Agent Mode surface (a NOOP here used to defeat
          // ChatContextMenu's `&& showIndexingCard` guard and leak a chip
          // whose click did nothing).
          // No placeholder swap while context is loading, on purpose: loads
          // often clear in ~hundreds of ms, so any transient placeholder (text
          // or color) flickers in and out and reads as a glitch. The status
          // icon covers the loading state; the queued-row "Waiting for
          // context" prefix explains an actually-held send.
          topRightAccessory={contextStatusIndicator}
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
          <Clock
            className={cn(
              "tw-size-3 tw-shrink-0",
              m.queueReason === "context" ? "tw-text-warning" : "tw-text-muted"
            )}
          />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-whitespace-nowrap tw-text-normal">
            {m.queueReason === "context" && (
              <span className="tw-font-semibold tw-text-warning">Waiting for context · </span>
            )}
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
