import type { ClientView } from "@/agentMode/protocol/ClientView";
import { checkImageLimits, decodedBase64Bytes } from "@/agentMode/protocol/limits";
import { useClientView } from "@/agentMode/protocol/react";
import { EMPTY_CHAT_RUNTIME } from "@/agentMode/protocol/selectors";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import type { PromptContent } from "@/agentMode/session/types";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import {
  clearSelectedTextContexts,
  removeSelectedTextContext,
  useSelectedTextContexts,
} from "@/aiParams";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import ChatInput, { type ChatInputHandle } from "@/components/chat-components/ChatInput";
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { useAgentBrands } from "@/agentMode/ui/hooks/useAgentBrands";
import { DISCONNECTED_MESSAGE } from "@/agentMode/protocol/SessionClient";
import { useAgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import { useChatRuntime } from "@/agentMode/ui/hooks/useChatRuntime";
import { useSessionCommands } from "@/agentMode/ui/hooks/useSessionCommands";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { useAgentModePicker } from "@/agentMode/ui/useAgentModePicker";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { ACTIVE_WEB_TAB_MARKER, EVENT_NAMES } from "@/constants";
import { useCanUseMultiAgent } from "@/plusUtils";
import { EventTargetContext } from "@/context";
import { logError, logWarn } from "@/logger";
import { isFanout, resolveAnswerers } from "@/agentMode/ui/mentionedAgents";
import type { BackendId, SessionId } from "@/agentMode/session/types";
import { buildWebTabsWithActiveSnapshot } from "@/services/webViewerService/activeWebTabSnapshot";
import {
  isNoteSelectedTextContext,
  type MessageContext,
  type SelectedTextContext,
  type WebTabContext,
} from "@/types/message";
import { getModelKeyFromModel } from "@/settings/model";
import { modelSupportsVision } from "@/utils";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { mergeWebTabContexts } from "@/utils/urlNormalization";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { App, Notice, TFile } from "obsidian";
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentChatInputProps {
  client: SessionClient;
  view: ClientView;
  sessionId: SessionId;
  chatInputId: string;
  draft: AgentInputDraftControls;
  app: App;
  updateUserMessageHistory: (newMessage: string) => void;
  activeProjectId?: string;
  contextLoadBlocking?: boolean;
  disabled?: boolean;
  contextStatusIndicator?: React.ReactNode;
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

function queuedImageViolation(item: QueuedAgentMessage, budgetBytes?: number) {
  return checkImageLimits(
    (item.promptContent ?? []).flatMap((content) =>
      content.type === "image"
        ? [{ mimeType: content.mimeType, bytes: decodedBase64Bytes(content.data) }]
        : []
    ),
    budgetBytes
  );
}

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

function imageBlockToFile(block: PromptContent, index: number): File | null {
  if (block.type !== "image") return null;
  const extension = block.mimeType.split("/")[1] || "png";
  return new File([base64ToArrayBuffer(block.data)], `queued-image-${index + 1}.${extension}`, {
    type: block.mimeType,
  });
}

export const AgentChatInput = memo(function AgentChatInput({
  client,
  view,
  sessionId,
  chatInputId,
  draft,
  app,
  updateUserMessageHistory,
  activeProjectId,
  contextLoadBlocking = false,
  disabled = false,
  contextStatusIndicator,
}: AgentChatInputProps) {
  const eventTarget = useContext(EventTargetContext);
  const chatInputRef = useRef<ChatInputHandle>(null);

  const holdForContext =
    contextLoadBlocking && !!activeProjectId && activeProjectId !== GLOBAL_SCOPE;
  const [selectedTextContexts] = useSelectedTextContexts();
  const { activeWebTabForMentions } = useActiveWebTabState();

  const previousChatInputIdRef = useRef(chatInputId);

  const plusAllowsMultiAgent = useCanUseMultiAgent();
  const { multiAgentAllowed, imageBytesBudget } = useAgentPaneCapabilities();
  const canUseMultiAgent = multiAgentAllowed ?? plusAllowsMultiAgent;

  const commands = useSessionCommands(client, sessionId);
  const { isStarting, isTurnInFlight, hasPendingPlanPermission } =
    useChatRuntime(client, sessionId) ?? EMPTY_CHAT_RUNTIME;
  const { host } = useClientView(client, view);
  const mainAgentId: BackendId | null =
    host?.tabs.find((tab) => tab.id === sessionId)?.backendId ??
    host?.host.startingBackendId ??
    null;
  const modelPickerOverride = useAgentModelPicker(client, view);
  const modePickerOverride = useAgentModePicker(client, view);
  const handleCycleMode = useCallback(() => {
    if (!modePickerOverride || modePickerOverride.disabled) return;
    const { options, value, onChange } = modePickerOverride;
    if (options.length === 0) return;
    const currentIdx = options.findIndex((o) => o.value === value);
    const next = options[(currentIdx + 1) % options.length];
    if (next.value !== value) onChange(next.value);
  }, [modePickerOverride]);

  const { installed: installedAgentBrands, cloudAgentIds } = useAgentBrands(client);
  const agentBrands = canUseMultiAgent ? installedAgentBrands : EMPTY_AGENT_MENTION_BRANDS;
  const installedAgentIds = useMemo(
    () => new Set(installedAgentBrands.map((b) => b.id)),
    [installedAgentBrands]
  );
  const mentionedAgentIdsRef = useRef<string[]>([]);
  const handleMentionedAgentsChange = useCallback((backendIds: string[]) => {
    mentionedAgentIdsRef.current = backendIds;
  }, []);

  const loading = draft.loading || isTurnInFlight;
  const {
    input: inputMessage,
    images: selectedImages,
    contextNotes,
    includeActiveNote,
    includeActiveWebTab,
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

  useEffect(() => {
    if (previousChatInputIdRef.current === chatInputId) return;
    previousChatInputIdRef.current = chatInputId;
    clearSelectedTextContexts();
    mentionedAgentIdsRef.current = [];
  }, [chatInputId]);

  const restoreToComposer = useCallback(
    (restored: QueuedAgentMessage) => {
      chatInputRef.current?.prependContent(
        restored.text,
        restored.mentionedAgents ?? [],
        restored.context?.webTabs ?? []
      );
      const notes = restored.context?.notes ?? [];
      if (notes.length > 0) {
        setContextNotes((previous) => dedupeBy([...notes, ...previous], (note) => note.path));
      }
      const images = (restored.promptContent ?? [])
        .map(imageBlockToFile)
        .filter((file): file is File => file !== null);
      if (images.length > 0) setSelectedImages((previous) => [...images, ...previous]);
    },
    [setContextNotes, setSelectedImages]
  );

  const handleStopGenerating = useCallback(async () => {
    // Restore before cancellation can finish the turn and flush the queue.
    // Only runSend owns loading; a late cancel must not mark a newer turn idle.
    // Selected text remains ephemeral and is deliberately not restored.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/365
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/485
    setQueuedMessages([]);
    if (queuedMessages.length > 0) restoreToComposer(combineQueuedMessages(queuedMessages));
    try {
      await commands.cancel();
    } catch (e) {
      logError("[AgentMode] cancel failed", e);
    }
  }, [commands, queuedMessages, restoreToComposer, setQueuedMessages]);

  const queuedMessagesRef = useRef(queuedMessages);
  queuedMessagesRef.current = queuedMessages;

  const runSend = useCallback(
    async (item: QueuedAgentMessage) => {
      const originChatInputId = chatInputId;
      setLoading(true);
      try {
        const { turn } = await commands.send(
          item.text,
          item.context,
          item.promptContent,
          item.mentionedAgents
        );
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
        await turn;
      } catch (error) {
        logError("Error sending agent message:", error);
        // The composer was cleared before the send, so a message that failed (a dropped connection
        // is the common cause on a phone) returns to it, ahead of the follow-ups queued behind it so
        // they keep their order and are not sent into the same failure. A composer the user has left
        // is not written to. A dropped connection can also mean the host ran the message and its
        // answer was lost, so that notice does not tell the user to send it again blindly.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
        if (previousChatInputIdRef.current === originChatInputId) {
          const followUps = queuedMessagesRef.current;
          setQueuedMessages([]);
          restoreToComposer(
            followUps.length > 0 ? combineQueuedMessages([item, ...followUps]) : item
          );
        }
        new Notice(
          error instanceof Error && error.message === DISCONNECTED_MESSAGE
            ? "Connection lost while sending. Your message is back in the box: check the chat, and send it again only if it did not arrive."
            : "Failed to send message. Please try again."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      chatInputId,
      commands,
      restoreToComposer,
      setLoading,
      setQueuedMessages,
      updateUserMessageHistory,
    ]
  );

  const handleSendMessage = useCallback(
    async (webTabs?: WebTabContext[]) => {
      if (disabled) return;
      const text = inputMessage.trim();
      if (!text && selectedImages.length === 0) return;
      const rawInput = inputMessage;

      const activeFile = app.workspace.getActiveFile();

      const candidateNotes: TFile[] = [];
      if (includeActiveNote && activeFile) {
        candidateNotes.push(activeFile);
      }
      candidateNotes.push(...contextNotes);
      const notes = dedupeBy(candidateNotes, (n) => n.path);

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

      const hasAnySelection = selectedTextContexts.length > 0;
      const shouldIncludeActiveWebTab =
        !hasAnySelection && (includeActiveWebTab || resolvedText.includes(ACTIVE_WEB_TAB_MARKER));
      const resolvedWebTabs = buildWebTabsWithActiveSnapshot(
        app,
        webTabs ?? [],
        shouldIncludeActiveWebTab
      );

      if (selectedImages.length > 0 && unsupportedImageModelLabel) {
        new Notice(
          `${unsupportedImageModelLabel} doesn't support images. Switch to a vision-capable model to send images.`
        );
        return;
      }

      const imageViolation = checkImageLimits(
        selectedImages.map((file) => ({ mimeType: file.type || "image/png", bytes: file.size })),
        imageBytesBudget
      );
      if (imageViolation) {
        new Notice(imageViolation.message);
        return;
      }

      let mentionedAgents: ReadonlyArray<BackendId> | undefined;
      if (mainAgentId) {
        const answerers = resolveAnswerers({
          mentionedAgentIds: mentionedAgentIdsRef.current,
          installedAgentIds,
        });
        if (isFanout(answerers, mainAgentId)) mentionedAgents = answerers;
      }

      mentionedAgentIdsRef.current = [];
      resetCompose();
      clearSelectedTextContexts();

      const content: PromptContent[] = [];
      for (const image of selectedImages) {
        const block = await fileToImageBlock(image);
        if (block) content.push(block);
      }

      // Failed image reads must not turn an image-only message into an empty request.
      // https://github.com/logancyang/obsidian-copilot/issues/2850
      if (selectedImages.length > 0 && !resolvedText && content.length === 0) {
        new Notice("Could not read the attached images. Please attach them again.");
        return;
      }

      const item: QueuedAgentMessage = {
        id: `queued-${uuidv4()}`,
        text: resolvedText,
        rawInput,
        context: buildMessageContext(notes, selectedTextContexts, resolvedWebTabs),
        promptContent: content.length > 0 ? content : undefined,
        mentionedAgents,
      };

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
      imageBytesBudget,
      holdForContext,
      disabled,
      resetCompose,
      runSend,
      setQueuedMessages,
      mainAgentId,
      installedAgentIds,
    ]
  );

  useEffect(() => {
    if (disabled || loading || isStarting || holdForContext || queuedMessages.length === 0) return;
    // Follow-ups that together exceed a message's image limits go out one at a time.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/611
    let batch = queuedMessages;
    let combined = combineQueuedMessages(batch);
    if (batch.length > 1 && queuedImageViolation(combined, imageBytesBudget)) {
      batch = batch.slice(0, 1);
      combined = batch[0];
    }
    if (
      combined.promptContent?.some((content) => content.type === "image") &&
      unsupportedImageModelLabel
    ) {
      new Notice(
        `${unsupportedImageModelLabel} doesn't support images. Switch to a vision-capable model to send images.`
      );
      return;
    }
    const violation = queuedImageViolation(combined, imageBytesBudget);
    if (violation) {
      new Notice(violation.message);
      return;
    }
    setQueuedMessages((current) => current.slice(batch.length));
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
    imageBytesBudget,
  ]);

  const handleRemoveQueuedMessage = useCallback(
    (id: string) => {
      setQueuedMessages((q) => q.filter((m) => m.id !== id));
    },
    [setQueuedMessages]
  );

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
        <ChatInput
          ref={chatInputRef}
          key={chatInputId}
          isAgentMode
          placeholder="Ask anything • @ to add context • / for commands"
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={safeAsyncHandler((meta) => handleSendMessage(meta?.webTabs))}
          isGenerating={loading}
          onStopGenerating={safeAsyncHandler(handleStopGenerating)}
          onEscape={loading ? safeAsyncHandler(handleStopGenerating) : undefined}
          onShiftTab={modePickerOverride ? handleCycleMode : undefined}
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
          cloudAgentIds={cloudAgentIds}
          onMentionedAgentsChange={handleMentionedAgentsChange}
          topRightAccessory={contextStatusIndicator}
        />
      </div>
    </>
  );
});
