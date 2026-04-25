import { AgentToolCall } from "@/components/agent/AgentToolCall";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { AgentChatMessage } from "@/LLMProviders/agentMode/types";
import type { ChatMessage } from "@/types/message";
import { App } from "obsidian";
import React, { memo, useMemo } from "react";

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  app: App;
  onDelete: (messageId: string) => void;
}

/**
 * Maps an AgentChatMessage to the subset of ChatMessage fields that
 * `ChatSingleMessage` consumes. Lets us reuse the leaf message renderer
 * without coupling Agent Mode types to the legacy `ChatMessage` shape.
 */
function toChatMessageView(m: AgentChatMessage): ChatMessage {
  return {
    id: m.id,
    sender: m.sender,
    message: m.message,
    timestamp: m.timestamp,
    isVisible: m.isVisible,
    isErrorMessage: m.isErrorMessage,
    content: m.content,
    context: m.context,
  };
}

const AgentChatMessages = memo(({ messages, app, onDelete }: AgentChatMessagesProps) => {
  const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
  const adapted = useMemo(() => visible.map(toChatMessageView), [visible]);
  const { containerMinHeight, scrollContainerCallbackRef, getMessageKey } = useChatScrolling({
    chatHistory: adapted,
  });

  if (visible.length === 0) {
    return <div className="tw-flex tw-size-full tw-flex-col tw-gap-2 tw-overflow-y-auto" />;
  }

  return (
    <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
      <div
        ref={scrollContainerCallbackRef}
        data-testid="chat-messages"
        className="tw-relative tw-flex tw-w-full tw-flex-1 tw-select-text tw-flex-col tw-items-start tw-justify-start tw-overflow-y-auto tw-scroll-smooth tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)]"
      >
        {visible.map((message, index) => {
          const isLastMessage = index === visible.length - 1;
          const shouldApplyMinHeight = isLastMessage && message.sender !== USER_SENDER;
          const adaptedMessage = adapted[index];

          return (
            <div
              key={getMessageKey(adaptedMessage, index)}
              data-message-key={getMessageKey(adaptedMessage, index)}
              className="tw-w-full"
              style={{
                minHeight: shouldApplyMinHeight ? `${containerMinHeight}px` : "auto",
              }}
            >
              {message.parts && message.parts.length > 0 ? (
                <div className="tw-flex tw-flex-col tw-gap-1 tw-px-3 tw-pt-2">
                  {message.parts.map((part, partIndex) => (
                    <AgentToolCall key={partIndex} part={part} />
                  ))}
                </div>
              ) : null}
              <ChatSingleMessage
                message={adaptedMessage}
                app={app}
                isStreaming={false}
                onDelete={() => onDelete(message.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

AgentChatMessages.displayName = "AgentChatMessages";

export default AgentChatMessages;
