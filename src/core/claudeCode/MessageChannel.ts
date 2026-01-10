/**
 * Message Channel for Claude Code SDK
 *
 * Implements an AsyncIterable queue for streaming user messages to the SDK.
 * Supports message queueing, merging of consecutive text messages, and
 * proper async iteration protocol.
 */

import { logInfo, logWarn } from "@/logger";
import { SDKUserMessage, APIUserMessage } from "./types";

/**
 * Maximum number of messages that can be queued
 */
const MAX_QUEUE_DEPTH = 8;

/**
 * Maximum character limit for merged text messages
 */
const MAX_MERGED_TEXT_LENGTH = 12000;

/**
 * Message Channel state
 */
interface ChannelState {
  /** Whether the channel is closed */
  closed: boolean;
  /** Queued messages waiting to be consumed */
  queue: SDKUserMessage[];
  /** Pending promise resolvers for next() calls */
  pending: Array<{
    resolve: (
      value:
        | IteratorResult<SDKUserMessage, void>
        | PromiseLike<IteratorResult<SDKUserMessage, void>>
    ) => void;
    reject: (reason?: unknown) => void;
  }>;
}

/**
 * MessageChannel - Async iterable queue for SDK user messages
 *
 * This class implements the AsyncIterable interface to allow streaming
 * user messages to the Claude Agent SDK. It supports:
 * - Queueing messages while the SDK is processing
 * - Merging consecutive text messages (up to 12,000 chars)
 * - Maximum queue depth of 8 messages
 * - Proper cleanup and error handling
 *
 * @example
 * ```typescript
 * const channel = new MessageChannel();
 *
 * // Use with SDK
 * const query = sdkQuery({
 *   prompt: channel,
 *   options: { ... }
 * });
 *
 * // Send messages
 * channel.push("Hello!");
 * channel.push("How are you?"); // Will be merged with previous
 *
 * // Close when done
 * channel.close();
 * ```
 */
export class MessageChannel implements AsyncIterable<SDKUserMessage> {
  private state: ChannelState = {
    closed: false,
    queue: [],
    pending: [],
  };

  private sessionId: string;
  private messageCounter = 0;

  /**
   * Create a new MessageChannel
   *
   * @param sessionId - The session ID for messages (optional, will be generated)
   */
  constructor(sessionId?: string) {
    this.sessionId =
      sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    logInfo(`[MessageChannel] Created with session ID: ${this.sessionId}`);
  }

  /**
   * Create a user message from text content
   *
   * @param content - The message content
   * @returns SDKUserMessage
   */
  private createUserMessage(content: string): SDKUserMessage {
    this.messageCounter++;
    const apiMessage: APIUserMessage = {
      role: "user",
      content,
    };

    return {
      type: "user",
      session_id: this.sessionId,
      message: apiMessage,
      parent_tool_use_id: null,
    };
  }

  /**
   * Get the text content from a user message
   *
   * @param message - The SDK user message
   * @returns The text content or null if not a simple text message
   */
  private getTextContent(message: SDKUserMessage): string | null {
    const content = message.message.content;
    if (typeof content === "string") {
      return content;
    }
    return null;
  }

  /**
   * Attempt to merge a new message with the last queued message
   *
   * @param newMessage - The new message to potentially merge
   * @returns true if merged, false if message should be added separately
   */
  private tryMergeMessage(newMessage: SDKUserMessage): boolean {
    if (this.state.queue.length === 0) {
      return false;
    }

    const lastMessage = this.state.queue[this.state.queue.length - 1];
    const lastContent = this.getTextContent(lastMessage);
    const newContent = this.getTextContent(newMessage);

    // Only merge if both are simple text messages
    if (lastContent === null || newContent === null) {
      return false;
    }

    // Check if merged content would exceed limit
    const mergedLength = lastContent.length + 1 + newContent.length; // +1 for newline
    if (mergedLength > MAX_MERGED_TEXT_LENGTH) {
      return false;
    }

    // Merge the messages
    const mergedContent = `${lastContent}\n${newContent}`;
    const mergedMessage = this.createUserMessage(mergedContent);
    mergedMessage.uuid = lastMessage.uuid; // Keep original UUID

    this.state.queue[this.state.queue.length - 1] = mergedMessage;
    logInfo(`[MessageChannel] Merged message (total length: ${mergedContent.length})`);
    return true;
  }

  /**
   * Push a message onto the channel
   *
   * If the queue is full, the oldest message will be dropped.
   * Consecutive text messages will be merged if possible.
   *
   * @param content - The message content (string or SDKUserMessage)
   * @returns true if the message was queued, false if the channel is closed
   */
  push(content: string | SDKUserMessage): boolean {
    if (this.state.closed) {
      logWarn("[MessageChannel] Cannot push to closed channel");
      return false;
    }

    // Convert string to SDKUserMessage
    const message: SDKUserMessage =
      typeof content === "string" ? this.createUserMessage(content) : content;

    // Try to merge with the last message first
    if (this.tryMergeMessage(message)) {
      this.deliverIfPending();
      return true;
    }

    // Check queue depth
    if (this.state.queue.length >= MAX_QUEUE_DEPTH) {
      logWarn(`[MessageChannel] Queue full (${MAX_QUEUE_DEPTH}), dropping oldest message`);
      this.state.queue.shift();
    }

    // Add to queue
    this.state.queue.push(message);
    logInfo(`[MessageChannel] Queued message (queue size: ${this.state.queue.length})`);

    // Deliver to any waiting consumers
    this.deliverIfPending();

    return true;
  }

  /**
   * Deliver queued messages to pending consumers
   */
  private deliverIfPending(): void {
    while (this.state.pending.length > 0 && this.state.queue.length > 0) {
      const resolver = this.state.pending.shift()!;
      const message = this.state.queue.shift()!;
      resolver.resolve({ value: message, done: false });
      logInfo("[MessageChannel] Delivered message to consumer");
    }

    // If channel is closed and queue is empty, resolve remaining pending with done
    if (this.state.closed && this.state.queue.length === 0) {
      while (this.state.pending.length > 0) {
        const resolver = this.state.pending.shift()!;
        resolver.resolve({ value: undefined, done: true });
      }
    }
  }

  /**
   * Close the channel
   *
   * After closing, no new messages can be pushed.
   * Existing queued messages will still be delivered.
   */
  close(): void {
    if (this.state.closed) {
      return;
    }

    this.state.closed = true;
    logInfo("[MessageChannel] Channel closed");

    // Deliver any remaining messages or signal done
    this.deliverIfPending();
  }

  /**
   * Check if the channel is closed
   */
  isClosed(): boolean {
    return this.state.closed;
  }

  /**
   * Get the current queue size
   */
  queueSize(): number {
    return this.state.queue.length;
  }

  /**
   * Clear all queued messages
   */
  clear(): void {
    const cleared = this.state.queue.length;
    this.state.queue = [];
    logInfo(`[MessageChannel] Cleared ${cleared} queued messages`);
  }

  /**
   * Implement AsyncIterator.next()
   */
  private async next(): Promise<IteratorResult<SDKUserMessage, void>> {
    // If there are queued messages, return immediately
    if (this.state.queue.length > 0) {
      const message = this.state.queue.shift()!;
      return { value: message, done: false };
    }

    // If closed and no more messages, signal done
    if (this.state.closed) {
      return { value: undefined, done: true };
    }

    // Wait for a message to be pushed
    return new Promise((resolve, reject) => {
      this.state.pending.push({ resolve, reject });
    });
  }

  /**
   * Implement AsyncIterable protocol
   */
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
      throw: async (error) => {
        this.state.closed = true;
        // Reject all pending promises
        while (this.state.pending.length > 0) {
          const resolver = this.state.pending.shift()!;
          resolver.reject(error);
        }
        return { value: undefined, done: true };
      },
    };
  }
}

/**
 * Create a simple one-shot message channel from a single prompt
 *
 * This is a convenience function for when you just want to send
 * a single prompt and get a response.
 *
 * @param prompt - The prompt text
 * @param sessionId - Optional session ID
 * @returns A MessageChannel with the prompt already queued and closed
 */
export function createPromptChannel(prompt: string, sessionId?: string): MessageChannel {
  const channel = new MessageChannel(sessionId);
  channel.push(prompt);
  channel.close();
  return channel;
}
