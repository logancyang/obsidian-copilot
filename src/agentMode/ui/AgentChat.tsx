import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import ChatInput from "@/components/chat-components/ChatInput";
import { EVENT_NAMES } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice, TFile } from "obsidian";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";

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
    return backend.subscribe(() => {
      if (isMountedRef.current) setMessages(backend.getMessages());
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
    if (isMountedRef.current) setLoading(false);
  }, [backend]);

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage) return;

    // Agent Mode (M0) only supports plain text. Surface a Notice and drop any
    // attachments so the user message bubble stays consistent with what the
    // agent actually receives. Remove this once ACP content blocks / vault
    // context are wired through `buildPromptBlocks` in AgentSession.
    const hasAttachments =
      selectedImages.length > 0 ||
      contextNotes.length > 0 ||
      includeActiveNote ||
      includeActiveWebTab;
    if (hasAttachments) {
      new Notice("Attachments aren't supported in Agent Mode yet — sending text only.");
    }

    try {
      const text = inputMessage.trim();
      const rawInput = inputMessage;
      setInputMessage("");
      setSelectedImages([]);
      setContextNotes([]);
      setIncludeActiveNote(false);
      setIncludeActiveWebTab(false);
      setLoading(true);

      const { turn } = backend.sendMessage(text);
      if (rawInput) updateUserMessageHistory(rawInput);
      await turn;
    } catch (error) {
      logError("Error sending agent message:", error);
      new Notice("Failed to send message. Please try again.");
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [
    backend,
    inputMessage,
    selectedImages,
    contextNotes,
    includeActiveNote,
    includeActiveWebTab,
    updateUserMessageHistory,
  ]);

  const handleNewChat = useCallback(async () => {
    await handleStopGenerating();
    backend.clearMessages();
    setContextNotes([]);
  }, [backend, handleStopGenerating]);

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

  const modelPickerOverride = useAgentModelPicker(backend, manager);

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
            <AgentChatMessages messages={messages} app={app} onDelete={handleDelete} />
            <AgentChatControls onNewChat={handleNewChat} />
            <ChatInput
              inputMessage={inputMessage}
              setInputMessage={setInputMessage}
              handleSendMessage={() => handleSendMessage()}
              isGenerating={loading}
              onStopGenerating={() => handleStopGenerating()}
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
              showProgressCard={NOOP}
              showIndexingCard={NOOP}
            />
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

export default AgentChat;
