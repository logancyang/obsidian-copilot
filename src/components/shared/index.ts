/**
 * Shared components for chat functionality
 *
 * These components provide reusable chat building blocks that can be used
 * across different chat contexts (main Copilot chat, Projects+ Discuss, etc.)
 */

export { ChatEditorCore } from "./ChatEditorCore";
export type { ChatEditorCoreProps, ChatEditorCoreRef } from "./ChatEditorCore";

export { MessageList } from "./MessageList";
export type {
  BaseMessage,
  MessageListProps,
  MessageRenderProps,
  StreamingMessageProps,
} from "./MessageList";
