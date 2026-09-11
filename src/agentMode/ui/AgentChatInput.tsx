import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import type { PromptContent } from "@/agentMode/session/types";
import type {
  AgentQueuedTask,
  AgentQueueHoldReason,
} from "@/agentMode/session/AgentTaskCoordinator";
import type {
  AgentTaskSubmission,
  AgentVoiceSubmissionResolver,
} from "@/agentMode/session/voiceTypes";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import {
  clearSelectedTextContexts,
  removeSelectedTextContext,
  useSelectedTextContexts,
} from "@/aiParams";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import ChatInput, {
  type ChatInputProps,
  type ChatInputHandle,
} from "@/components/chat-components/ChatInput";
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { ACTIVE_WEB_TAB_MARKER, EVENT_NAMES } from "@/constants";
import { useCanUseMultiAgent } from "@/plusUtils";
import { EventTargetContext } from "@/context";
import { logWarn } from "@/logger";
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
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
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
   * Per-session compose draft, owned by AgentHome (the common owner of the
   * drop overlay that also feeds its context). Referentially stable, so it
   * doesn't break this component's memo on per-token stream re-renders.
   */
  draft: AgentInputDraftControls;
  app: App;
  /**
   * The session's main agent (the summarizer). Used by `isFanout` to collapse the
   * degenerate `[main]` selection to the single-agent path. `null` before a session lands.
   */
  mainAgentId: BackendId | null;
  updateUserMessageHistory: (newMessage: string) => void;
  /** Submissions the session's task owner has parked, in send order. */
  queuedTasks: readonly AgentQueuedTask[];
  /** True while a task is running. Drives the Stop button and the spinner. */
  isTaskActive: boolean;
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
}

// Frozen empty so a typed submission — which has no public entry yet — keeps
// a stable reference instead of allocating a fresh [] per send.
const EMPTY_SOURCE_MESSAGE_IDS: readonly string[] = Object.freeze([]);
const EMPTY_SELECTED_TEXT: readonly SelectedTextContext[] = Object.freeze([]);

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

async function readImageBlocks(images: readonly File[]): Promise<PromptContent[]> {
  const content: PromptContent[] = [];
  for (const image of images) {
    const block = await fileToImageBlock(image);
    if (block) content.push(block);
  }
  return content;
}

/**
 * Composer for Agent Mode: consumes per-chat-input draft state (input,
 * attachments, include flags), resolves attachments into one immutable
 * submission, and hands it to the session's task owner. Scheduling — whether a
 * submission runs now or queues behind the active turn — belongs to that owner,
 * so a second input channel cannot race a parallel queue. Memoized and detached
 * from the message stream so streamed tokens don't re-render the input. The
 * plan/permission gate (`pointer-events-none` while a plan permission is
 * pending) wraps the input.
 */
export const AgentChatInput = memo(function AgentChatInput({
  backend,
  plugin,
  chatInputId,
  draft,
  app,
  mainAgentId,
  updateUserMessageHistory,
  queuedTasks,
  isTaskActive,
  isStarting,
  hasPendingPlanPermission,
  modelPickerOverride,
  modePickerOverride,
  onCycleMode,
  activeProjectId,
  contextLoadBlocking = false,
  disabled = false,
  contextStatusIndicator,
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
  const chatInputRef = useRef<ChatInputHandle>(null);

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

  // Draft state is owned by AgentHome (so it can feed the drop overlay); this
  // composer is the controlled consumer.
  const {
    input: inputMessage,
    images: selectedImages,
    contextNotes,
    includeActiveNote,
    includeActiveWebTab,
    setInput: setInputMessage,
    setContextNotes,
    setSelectedImages,
    addImages,
    setIncludeActiveNote,
    setIncludeActiveWebTab,
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

  const currentSelectedTextContexts =
    previousChatInputIdRef.current === chatInputId ? selectedTextContexts : EMPTY_SELECTED_TEXT;
  const captureContext = useCallback(
    (
      text: string,
      webTabs: readonly WebTabContext[] = [],
      activeFile = app.workspace.getActiveFile()
    ) => {
      const notes = dedupeBy(
        [...(includeActiveNote && activeFile ? [activeFile] : []), ...contextNotes],
        (note) => note.path
      );
      const resolvedWebTabs = buildWebTabsWithActiveSnapshot(
        app,
        [...webTabs],
        currentSelectedTextContexts.length === 0 &&
          (includeActiveWebTab || text.includes(ACTIVE_WEB_TAB_MARKER))
      );
      return buildMessageContext(notes, currentSelectedTextContexts, resolvedWebTabs);
    },
    [app, includeActiveNote, contextNotes, currentSelectedTextContexts, includeActiveWebTab]
  );
  const resolveVoiceSubmission = useCallback<AgentVoiceSubmissionResolver>(
    async (text) => {
      if (disabled || hasPendingPlanPermission) {
        new Notice("Resolve the pending decision before sending spoken work.");
        throw new Error("Composer is unavailable");
      }
      if (selectedImages.length > 0 && unsupportedImageModelLabel) {
        new Notice(
          `${unsupportedImageModelLabel} doesn't support images. Switch to a vision-capable model to send images.`
        );
        throw new Error("The selected model cannot use the attached images");
      }
      // Capture before image reads so changes made while decoding belong to the
      // next request. Typed and spoken submissions use the same attachment path.
      // See designdocs/VOICE_CHAT_DEMO_DESIGN.md, "Text and voice context continuity".
      const context = captureContext(text, chatInputRef.current?.getAttachedWebTabs());
      const content = await readImageBlocks(selectedImages);
      if (content.length !== selectedImages.length) {
        new Notice("Could not read the attached images. Please attach them again.");
        throw new Error("The spoken request's image attachments could not be read");
      }
      return { context, promptContent: content.length > 0 ? content : undefined };
    },
    [disabled, hasPendingPlanPermission, selectedImages, unsupportedImageModelLabel, captureContext]
  );
  useEffect(
    () => backend.registerVoiceSubmissionResolver?.(resolveVoiceSubmission),
    [backend, resolveVoiceSubmission]
  );

  const handleStopGenerating = useCallback(async () => {
    // The task owner discards queued follow-ups before requesting
    // cancellation, so a cancel that finishes the turn cannot flush work the
    // user just abandoned.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/365
    await backend.cancelActiveAndClearQueue();
  }, [backend]);

  // A queued image cannot reach a model known to lack vision, and dropping the
  // attachment silently would send a different request than the user queued.
  // Hold the queue and say so instead.
  // https://github.com/logancyang/obsidian-copilot/issues/2850
  const queuedImageBlocked =
    unsupportedImageModelLabel !== null &&
    queuedTasks.some((task) =>
      task.submission.promptContent?.some((content) => content.type === "image")
    );
  useEffect(() => {
    if (!queuedImageBlocked) return;
    new Notice(
      `${unsupportedImageModelLabel} doesn't support images. Switch to a vision-capable model to send images.`
    );
  }, [queuedImageBlocked, unsupportedImageModelLabel]);

  // The task owner only dispatches for the FOREGROUND conversation: this
  // composer releases the hold while it is mounted and unregisters on unmount,
  // so switching chats never secretly flushes a backgrounded conversation's
  // queued work. Registration is per composer instance, because the same chat
  // can be composed from the sidebar and a popout at once and closing one of
  // them must not park the survivor's queue.
  // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
  const holderId = useMemo(() => `composer-${uuidv4()}`, []);
  const dispatchHold: AgentQueueHoldReason | null = holdForContext
    ? "context"
    : disabled || isStarting || queuedImageBlocked
      ? "busy"
      : null;
  useEffect(() => () => backend.releaseQueueHold(holderId), [backend, holderId]);
  useEffect(() => {
    backend.setQueueHold(dispatchHold, holderId);
  }, [backend, dispatchHold, holderId]);

  const handleSendMessage = useCallback(
    async (webTabs?: WebTabContext[]) => {
      // A hard-disabled composer (e.g. an orphaned project) must not send. The
      // wrapper only blocks pointer events + dims, so a focused editor could
      // otherwise submit a turn via the keyboard; bail before any prep work.
      if (disabled) return;
      const text = inputMessage.trim();
      // A screenshot can answer the preceding turn without additional text.
      // https://github.com/logancyang/obsidian-copilot/issues/2850
      if (!text && selectedImages.length === 0) return;
      const rawInput = inputMessage;

      const activeFile = app.workspace.getActiveFile();

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

      const context = captureContext(resolvedText, webTabs, activeFile);

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
      const content = await readImageBlocks(selectedImages);

      // Failed image reads must not turn an image-only message into an empty request.
      // https://github.com/logancyang/obsidian-copilot/issues/2850
      if (selectedImages.length > 0 && !resolvedText && content.length === 0) {
        new Notice("Could not read the attached images. Please attach them again.");
        return;
      }

      // One immutable payload: every attachment is already resolved, so the
      // task owner never reaches back into composer state. It decides whether
      // this runs now or waits behind the active turn.
      const submission: AgentTaskSubmission = {
        submissionId: `submission-${uuidv4()}`,
        conversationId: chatInputId,
        sourceMessageIds: EMPTY_SOURCE_MESSAGE_IDS,
        source: "typed",
        presentation: "text",
        requestText: resolvedText,
        rawInput,
        context,
        promptContent: content.length > 0 ? content : undefined,
        mentionedAgents,
      };
      const acceptance = backend.submitTask(submission);
      // A refused submission starts no turn, and the draft above was already
      // cleared for work that will not run. Say why and hand the user's text
      // and attachments back so the request is not silently lost.
      // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
      if (acceptance.disposition === "rejected") {
        new Notice(
          acceptance.rejectionReason
            ? `Failed to send message: ${acceptance.rejectionReason}`
            : "Failed to send message. Please try again."
        );
        setInputMessage(rawInput);
        if (selectedImages.length > 0) setSelectedImages(selectedImages);
        return;
      }
      if (rawInput) updateUserMessageHistory(rawInput);
    },
    [
      app,
      backend,
      chatInputId,
      inputMessage,
      selectedImages,
      captureContext,
      selectedTextContexts,
      unsupportedImageModelLabel,
      disabled,
      resetCompose,
      setInputMessage,
      setSelectedImages,
      updateUserMessageHistory,
      mainAgentId,
      installedAgentIds,
    ]
  );

  const handleRemoveQueuedMessage = useCallback(
    (taskId: string) => {
      backend.removeQueuedTask(taskId);
    },
    [backend]
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
      {queuedTasks.length > 0 && (
        <QueuedMessageList tasks={queuedTasks} onRemove={handleRemoveQueuedMessage} />
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
          ref={chatInputRef}
          isAgentMode
          placeholder="Ask anything • @ to add context • / for commands"
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={safeAsyncHandler((meta) => handleSendMessage(meta?.webTabs))}
          isGenerating={isTaskActive}
          onStopGenerating={safeAsyncHandler(handleStopGenerating)}
          onEscape={isTaskActive ? safeAsyncHandler(handleStopGenerating) : undefined}
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
