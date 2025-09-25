import React from "react";
import { createRoot, Root } from "react-dom/client";

import { ToolCallBanner } from "@/components/chat-components/ToolCallBanner";
import type { ToolCallMarker } from "@/LLMProviders/chainRunner/utils/toolCallParser";
import { logWarn } from "@/logger";

declare global {
  interface Window {
    __copilotToolCallRoots?: Map<string, Map<string, ToolCallRootRecord>>;
  }
}

export interface ToolCallRootRecord {
  root: Root;
  isUnmounting: boolean;
}

const STALE_ROOT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Retrieve the global registry that keeps track of tool call React roots.
 * The registry is stored on `window` to preserve state across component lifecycles.
 */
const getRegistry = (): Map<string, Map<string, ToolCallRootRecord>> => {
  if (!window.__copilotToolCallRoots) {
    window.__copilotToolCallRoots = new Map<string, Map<string, ToolCallRootRecord>>();
  }

  return window.__copilotToolCallRoots;
};

/**
 * Remove the message entry from the registry when it no longer has active tool call roots.
 */
const pruneEmptyMessageEntry = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>
): void => {
  if (messageRoots.size > 0) {
    return;
  }

  const registry = getRegistry();
  const currentRoots = registry.get(messageId);

  if (currentRoots === messageRoots) {
    registry.delete(messageId);
  }
};

/**
 * Unmount a tool call root, mark it as inactive, and remove it from the registry.
 */
const disposeToolCallRoot = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  record: ToolCallRootRecord,
  logContext: string
): void => {
  try {
    record.root.unmount();
  } catch (error) {
    logWarn(`Error unmounting tool call root during ${logContext}`, toolCallId, error);
  }

  record.isUnmounting = false;

  if (messageRoots.get(toolCallId) === record) {
    messageRoots.delete(toolCallId);
  }

  pruneEmptyMessageEntry(messageId, messageRoots);
};

/**
 * Schedule a deferred unmount for a tool call root while preventing duplicate requests.
 */
const scheduleToolCallRootDisposal = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  record: ToolCallRootRecord,
  logContext: string
): void => {
  if (record.isUnmounting) {
    return;
  }

  record.isUnmounting = true;

  setTimeout(() => {
    const registry = getRegistry();
    const currentRoots = registry.get(messageId);
    const currentRecord = currentRoots?.get(toolCallId);

    if (!currentRoots || currentRecord !== record) {
      record.isUnmounting = false;
      pruneEmptyMessageEntry(messageId, messageRoots);
      return;
    }

    disposeToolCallRoot(messageId, currentRoots, toolCallId, currentRecord, logContext);
  }, 0);
};

/**
 * Ensure a React root exists for the provided tool call container and return the root record.
 */
export const ensureToolCallRoot = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  container: HTMLElement,
  logContext: string
): ToolCallRootRecord => {
  let record = messageRoots.get(toolCallId);

  if (record?.isUnmounting) {
    disposeToolCallRoot(
      messageId,
      messageRoots,
      toolCallId,
      record,
      `${logContext} (finalizing stale root)`
    );
    record = undefined;
  }

  if (!record) {
    record = {
      root: createRoot(container),
      isUnmounting: false,
    };

    messageRoots.set(toolCallId, record);
  }

  return record;
};

/**
 * Render the `ToolCallBanner` component into the provided root record.
 */
export const renderToolCallBanner = (
  record: ToolCallRootRecord,
  toolCall: ToolCallMarker
): void => {
  record.root.render(
    <ToolCallBanner
      toolName={toolCall.toolName}
      displayName={toolCall.displayName}
      emoji={toolCall.emoji}
      isExecuting={toolCall.isExecuting}
      result={toolCall.result || null}
      confirmationMessage={toolCall.confirmationMessage}
    />
  );
};

/**
 * Schedule the removal of a tool call root from a message root collection.
 */
export const removeToolCallRoot = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  logContext: string
): void => {
  const record = messageRoots.get(toolCallId);

  if (!record) {
    return;
  }

  scheduleToolCallRootDisposal(messageId, messageRoots, toolCallId, record, logContext);
};

/**
 * Return (and create if necessary) the tool call root map for a specific message.
 */
export const getMessageToolCallRoots = (messageId: string): Map<string, ToolCallRootRecord> => {
  const registry = getRegistry();
  let messageRoots = registry.get(messageId);

  if (!messageRoots) {
    messageRoots = new Map<string, ToolCallRootRecord>();
    registry.set(messageId, messageRoots);
  }

  return messageRoots;
};

/**
 * Clean up tool call roots for messages whose identifiers encode timestamps older than the configured threshold.
 */
export const cleanupStaleToolCallRoots = (now: number = Date.now()): void => {
  const registry = getRegistry();

  registry.forEach((messageRoots, messageId) => {
    const timestamp = Number.parseInt(messageId, 10);

    if (Number.isNaN(timestamp) || now - timestamp < STALE_ROOT_MAX_AGE_MS) {
      return;
    }

    messageRoots.forEach((record, toolCallId) => {
      scheduleToolCallRootDisposal(
        messageId,
        messageRoots,
        toolCallId,
        record,
        "stale message cleanup"
      );
    });
  });
};

/**
 * Schedule cleanup for all tool call roots owned by a specific message.
 */
export const cleanupMessageToolCallRoots = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  logContext: string
): void => {
  messageRoots.forEach((record, toolCallId) => {
    scheduleToolCallRootDisposal(messageId, messageRoots, toolCallId, record, logContext);
  });
};
