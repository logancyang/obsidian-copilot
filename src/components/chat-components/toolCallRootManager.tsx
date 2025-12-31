import React from "react";
import { createRoot, Root } from "react-dom/client";

import { ErrorBlock } from "@/components/chat-components/ErrorBlock";
import { ToolCallBanner } from "@/components/chat-components/ToolCallBanner";
import type { ErrorMarker, ToolCallMarker } from "@/LLMProviders/chainRunner/utils/toolCallParser";
import { logWarn } from "@/logger";

declare global {
  interface Window {
    __copilotToolCallRoots?: Map<string, Map<string, ToolCallRootRecord>>;
    __copilotErrorBlocks?: Map<string, Map<string, ToolCallRootRecord>>;
  }
}

export interface ToolCallRootRecord {
  root: Root;
  isUnmounting: boolean;
  /** Reference to the DOM container to detect container changes across component lifecycles */
  container: HTMLElement;
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
 * Retrieve the global registry that keeps track of error block React roots.
 * Separate from tool call roots to prevent ID collisions and race conditions.
 */
const getErrorBlockRegistry = (): Map<string, Map<string, ToolCallRootRecord>> => {
  if (!window.__copilotErrorBlocks) {
    window.__copilotErrorBlocks = new Map<string, Map<string, ToolCallRootRecord>>();
  }

  return window.__copilotErrorBlocks;
};

/**
 * Remove the message entry from the registry when it no longer has active tool call roots.
 */
const pruneEmptyMessageEntry = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  registry: Map<string, Map<string, ToolCallRootRecord>>
): void => {
  if (messageRoots.size > 0) {
    return;
  }
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
  logContext: string,
  registry: Map<string, Map<string, ToolCallRootRecord>>
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
  pruneEmptyMessageEntry(messageId, messageRoots, registry);
};

/**
 * Handle container change by immediately removing the old record from the map
 * and scheduling a deferred unmount. This is used when the same messageId + toolCallId
 * is reused with a different DOM container (e.g., streaming -> history transition).
 */
const handleContainerChange = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  oldRecord: ToolCallRootRecord,
  logContext: string,
  registry: Map<string, Map<string, ToolCallRootRecord>>
): void => {
  // Immediately remove from map so new record can be created
  messageRoots.delete(toolCallId);

  // Mark as unmounting to prevent duplicate disposal attempts
  oldRecord.isUnmounting = true;

  // Defer unmount to avoid "synchronously unmount while React was already rendering" warning
  setTimeout(() => {
    try {
      oldRecord.root.unmount();
    } catch (error) {
      logWarn(`Error unmounting tool call root during ${logContext}`, toolCallId, error);
    }
    oldRecord.isUnmounting = false;

    // Prune empty message entry from registry
    pruneEmptyMessageEntry(messageId, messageRoots, registry);
  }, 0);
};

/**
 * Schedule a deferred unmount for a tool call root while preventing duplicate requests.
 */
const scheduleToolCallRootDisposal = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  record: ToolCallRootRecord,
  logContext: string,
  registry: Map<string, Map<string, ToolCallRootRecord>>
): void => {
  if (record.isUnmounting) {
    return;
  }

  record.isUnmounting = true;

  setTimeout(() => {
    const currentRoots = registry.get(messageId);
    const currentRecord = currentRoots?.get(toolCallId);

    if (!currentRoots || currentRecord !== record) {
      record.isUnmounting = false;
      pruneEmptyMessageEntry(messageId, messageRoots, registry);
      return;
    }
    disposeToolCallRoot(messageId, currentRoots, toolCallId, currentRecord, logContext, registry);
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
      `${logContext} (finalizing stale root)`,
      getRegistry()
    );
    record = undefined;
  }

  // Detect container change: if the record exists but points to a different container,
  // dispose the old root and create a new one. This happens when streaming component
  // unmounts (destroying its DOM) and history component mounts with a new container.
  // Only check if record.container exists (backwards compatibility with old registries).
  if (record && record.container && record.container !== container) {
    handleContainerChange(
      messageId,
      messageRoots,
      toolCallId,
      record,
      `${logContext} (container changed)`,
      getRegistry()
    );
    record = undefined;
  }

  if (!record) {
    record = {
      root: createRoot(container),
      isUnmounting: false,
      container,
    };

    messageRoots.set(toolCallId, record);
  }

  return record;
};

/**
 * Ensure a React root exists for the provided error block container and return the root record.
 * Uses a separate registry from tool calls to prevent ID collisions and race conditions.
 */
export const ensureErrorBlockRoot = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  errorId: string,
  container: HTMLElement,
  logContext: string
): ToolCallRootRecord => {
  let record = messageRoots.get(errorId);

  if (record?.isUnmounting) {
    disposeToolCallRoot(
      messageId,
      messageRoots,
      errorId,
      record,
      `${logContext} (finalizing stale error root)`,
      getErrorBlockRegistry()
    );
    record = undefined;
  }

  // Detect container change: if the record exists but points to a different container,
  // dispose the old root and create a new one.
  // Only check if record.container exists (backwards compatibility with old registries).
  if (record && record.container && record.container !== container) {
    handleContainerChange(
      messageId,
      messageRoots,
      errorId,
      record,
      `${logContext} (container changed)`,
      getErrorBlockRegistry()
    );
    record = undefined;
  }

  if (!record) {
    record = {
      root: createRoot(container),
      isUnmounting: false,
      container,
    };

    messageRoots.set(errorId, record);
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
 * Render the `ErrorBlock` component into the provided root record.
 */
export const renderErrorBlock = (record: ToolCallRootRecord, error: ErrorMarker): void => {
  record.root.render(<ErrorBlock errorContent={error.errorContent} />);
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
  scheduleToolCallRootDisposal(
    messageId,
    messageRoots,
    toolCallId,
    record,
    logContext,
    getRegistry()
  );
};

/**
 * Schedule the removal of an error block root from a message root collection.
 */
export const removeErrorBlockRoot = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  errorId: string,
  logContext: string
): void => {
  const record = messageRoots.get(errorId);

  if (!record) {
    return;
  }
  scheduleToolCallRootDisposal(
    messageId,
    messageRoots,
    errorId,
    record,
    logContext,
    getErrorBlockRegistry()
  );
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
 * Return (and create if necessary) the error block root map for a specific message.
 * Uses a separate registry from tool calls to prevent ID collisions.
 */
export const getMessageErrorBlockRoots = (messageId: string): Map<string, ToolCallRootRecord> => {
  const registry = getErrorBlockRegistry();
  let messageRoots = registry.get(messageId);

  if (!messageRoots) {
    messageRoots = new Map<string, ToolCallRootRecord>();
    registry.set(messageId, messageRoots);
  }

  return messageRoots;
};

/**
 * Clean up tool call roots that are no longer attached to the DOM.
 * Uses container.isConnected for records with container reference,
 * falls back to timestamp-based cleanup for legacy records.
 */
export const cleanupStaleToolCallRoots = (now: number = Date.now()): void => {
  const registry = getRegistry();

  registry.forEach((messageRoots, messageId) => {
    messageRoots.forEach((record, toolCallId) => {
      // Primary cleanup: check if container is detached from DOM
      if (record.container) {
        if (record.container.isConnected) {
          return; // Container still in DOM, skip cleanup
        }
        scheduleToolCallRootDisposal(
          messageId,
          messageRoots,
          toolCallId,
          record,
          "stale cleanup (detached container)",
          registry
        );
        return;
      }

      // Fallback for legacy records without container: use timestamp-based cleanup
      const timestamp = Number.parseInt(messageId, 10);
      if (Number.isNaN(timestamp) || now - timestamp < STALE_ROOT_MAX_AGE_MS) {
        return;
      }
      scheduleToolCallRootDisposal(
        messageId,
        messageRoots,
        toolCallId,
        record,
        "stale cleanup (legacy record)",
        registry
      );
    });
  });
};

/**
 * Clean up error block roots that are no longer attached to the DOM.
 * Uses container.isConnected for records with container reference,
 * falls back to timestamp-based cleanup for legacy records.
 */
export const cleanupStaleErrorBlockRoots = (now: number = Date.now()): void => {
  const registry = getErrorBlockRegistry();

  registry.forEach((messageRoots, messageId) => {
    messageRoots.forEach((record, errorId) => {
      // Primary cleanup: check if container is detached from DOM
      if (record.container) {
        if (record.container.isConnected) {
          return; // Container still in DOM, skip cleanup
        }
        scheduleToolCallRootDisposal(
          messageId,
          messageRoots,
          errorId,
          record,
          "stale error cleanup (detached container)",
          registry
        );
        return;
      }

      // Fallback for legacy records without container: use timestamp-based cleanup
      const timestamp = Number.parseInt(messageId, 10);
      if (Number.isNaN(timestamp) || now - timestamp < STALE_ROOT_MAX_AGE_MS) {
        return;
      }
      scheduleToolCallRootDisposal(
        messageId,
        messageRoots,
        errorId,
        record,
        "stale error cleanup (legacy record)",
        registry
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
  const registry = getRegistry();
  messageRoots.forEach((record, toolCallId) => {
    scheduleToolCallRootDisposal(messageId, messageRoots, toolCallId, record, logContext, registry);
  });
};

/**
 * Schedule cleanup for all error block roots owned by a specific message.
 */
export const cleanupMessageErrorBlockRoots = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  logContext: string
): void => {
  const registry = getErrorBlockRegistry();
  messageRoots.forEach((record, errorId) => {
    scheduleToolCallRootDisposal(messageId, messageRoots, errorId, record, logContext, registry);
  });
};
