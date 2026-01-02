/**
 * DiscussView - Main container component for Discuss feature
 */

import CopilotPlugin from "@/main";
import { DiscussChatState } from "@/state/DiscussChatState";
import { useDiscussChat } from "@/hooks/useDiscussChat";
import { Project } from "@/types/projects-plus";
import { MessageSquare } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DiscussHeader } from "./DiscussHeader";
import { DiscussInput } from "./DiscussInput";
import { DiscussMessage } from "./DiscussMessage";
import { SuggestedQuestions } from "./SuggestedQuestions";

interface DiscussViewProps {
  project: Project;
  plugin: CopilotPlugin;
  conversationId?: string; // Resume existing conversation
  onBack: () => void;
}

/**
 * Main Discuss view container
 */
export function DiscussView({ project, plugin, conversationId, onBack }: DiscussViewProps) {
  // Create state instance (memoized to prevent recreation)
  const chainManager = plugin.projectModeManager.getCurrentChainManager();
  const state = useMemo(
    () => new DiscussChatState(plugin.app, project, chainManager, plugin.projectsPlusManager),
    [plugin.app, project, chainManager, plugin.projectsPlusManager]
  );

  const {
    messages,
    isStreaming,
    streamContent,
    conversationTitle,
    sendMessage,
    startNewConversation,
    loadConversation,
    renameConversation,
    abortResponse,
    generateSuggestedQuestions,
  } = useDiscussChat(state);

  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Initialize conversation
  useEffect(() => {
    const init = async () => {
      if (conversationId) {
        try {
          await loadConversation(conversationId);
        } catch {
          // If conversation not found, start new
          await startNewConversation();
        }
      } else {
        await startNewConversation();
        // Generate suggested questions for new conversation
        setLoadingSuggestions(true);
        try {
          const questions = await generateSuggestedQuestions();
          setSuggestedQuestions(questions);
        } finally {
          setLoadingSuggestions(false);
        }
      }
    };
    init();
  }, [conversationId, loadConversation, startNewConversation, generateSuggestedQuestions]);

  const handleOpenNote = useCallback(
    (path: string) => {
      plugin.app.workspace.openLinkText(path, "");
    },
    [plugin.app.workspace]
  );

  const handleSelectQuestion = useCallback(
    (question: string) => {
      sendMessage(question);
      setSuggestedQuestions([]);
    },
    [sendMessage]
  );

  const handleRenameConversation = useCallback(() => {
    // Simple prompt for renaming
    const newTitle = prompt("Enter conversation title:", conversationTitle);
    if (newTitle && newTitle.trim()) {
      renameConversation(newTitle.trim());
    }
  }, [conversationTitle, renameConversation]);

  const handleNewConversation = useCallback(async () => {
    await startNewConversation();
    setSuggestedQuestions([]);
    setLoadingSuggestions(true);
    try {
      const questions = await generateSuggestedQuestions();
      setSuggestedQuestions(questions);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [startNewConversation, generateSuggestedQuestions]);

  // Auto-scroll to bottom when messages change
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <DiscussHeader
        project={project}
        conversationTitle={conversationTitle}
        onBack={onBack}
        onNewConversation={handleNewConversation}
        onRenameConversation={handleRenameConversation}
      />

      {/* Messages area */}
      <div className="tw-flex-1 tw-overflow-y-auto tw-px-4">
        {messages.length === 0 ? (
          // Empty state with suggested questions
          <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center tw-gap-4 tw-p-4">
            <div className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-text-center">
              <MessageSquare className="tw-size-8 tw-text-muted" />
              <p className="tw-text-sm tw-text-muted">Start a conversation about your project</p>
            </div>
            <SuggestedQuestions
              questions={suggestedQuestions}
              onSelect={handleSelectQuestion}
              loading={loadingSuggestions}
            />
          </div>
        ) : (
          // Message list
          <div className="tw-py-2">
            {messages.map((message, index) => (
              <DiscussMessage
                key={message.id || index}
                message={message}
                isStreaming={false}
                onOpenNote={handleOpenNote}
                app={plugin.app}
              />
            ))}

            {/* Streaming message */}
            {isStreaming && streamContent && (
              <DiscussMessage
                message={{
                  message: streamContent,
                  sender: "AI",
                  isVisible: true,
                  timestamp: null,
                }}
                isStreaming={true}
                onOpenNote={handleOpenNote}
                app={plugin.app}
              />
            )}

            {/* Loading indicator when streaming but no content yet */}
            {isStreaming && !streamContent && (
              <div className="tw-flex tw-items-start tw-py-2">
                <div className="tw-rounded tw-bg-secondary tw-px-3 tw-py-2">
                  <span className="tw-animate-pulse tw-text-sm tw-text-muted">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <DiscussInput
        project={project}
        onSend={sendMessage}
        disabled={isStreaming}
        app={plugin.app}
        onAbort={isStreaming ? abortResponse : undefined}
      />
    </div>
  );
}
