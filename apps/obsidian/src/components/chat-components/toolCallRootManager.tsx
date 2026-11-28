import React from "react";
import { Root } from "react-dom/client";

import { ErrorBlock } from "@/components/chat-components/ErrorBlock";
import { ToolCallBanner } from "@/components/chat-components/ToolCallBanner";
import type { ErrorMarker, ToolCallMarker } from "@/LLMProviders/chainRunner/utils/toolCallParser";
import { logWarn } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { App } from "obsidian";

declare global {
  interface Window {
    __copilotToolCallRoots?: Map<string, Map<string, ToolCallRootRecord>>;
    __copilotErrorBlocks?: Map<string, Map<string, ToolCallRootRecord>>;
  }
}

export interface ToolCallRootRecord {
  root: Root;
  isUnmounting: boolean;
  container: HTMLElement;
}

const STALE_ROOT_MAX_AGE_MS = 60 * 60 * 1000;

const getRegistry = (): Map<string, Map<string, ToolCallRootRecord>> => {
  if (!window.__copilotToolCallRoots) {
    window.__copilotToolCallRoots = new Map<string, Map<string, ToolCallRootRecord>>();
  }

  return window.__copilotToolCallRoots;
};

const getErrorBlockRegistry = (): Map<string, Map<string, ToolCallRootRecord>> => {
  if (!window.__copilotErrorBlocks) {
    window.__copilotErrorBlocks = new Map<string, Map<string, ToolCallRootRecord>>();
  }

  return window.__copilotErrorBlocks;
};

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

const handleContainerChange = (
  messageId: string,
  messageRoots: Map<string, ToolCallRootRecord>,
  toolCallId: string,
  oldRecord: ToolCallRootRecord,
  logContext: string,
  registry: Map<string, Map<string, ToolCallRootRecord>>
): void => {
  messageRoots.delete(toolCallId);

  oldRecord.isUnmounting = true;

  window.setTimeout(() => {
    try {
      oldRecord.root.unmount();
    } catch (error) {
      logWarn(`Error unmounting tool call root during ${logContext}`, toolCallId, error);
    }
    oldRecord.isUnmounting = false;

    pruneEmptyMessageEntry(messageId, messageRoots, registry);
  }, 0);
};

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

  window.setTimeout(() => {
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

export const ensureToolCallRoot = (
  app: App,
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
      root: createPluginRoot(container, app),
      isUnmounting: false,
      container,
    };

    messageRoots.set(toolCallId, record);
  }

  return record;
};

export const ensureErrorBlockRoot = (
  app: App,
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
      root: createPluginRoot(container, app),
      isUnmounting: false,
      container,
    };

    messageRoots.set(errorId, record);
  }

  return record;
};

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

export const renderErrorBlock = (record: ToolCallRootRecord, error: ErrorMarker): void => {
  record.root.render(<ErrorBlock errorContent={error.errorContent} />);
};

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

export const getMessageToolCallRoots = (messageId: string): Map<string, ToolCallRootRecord> => {
  const registry = getRegistry();
  let messageRoots = registry.get(messageId);

  if (!messageRoots) {
    messageRoots = new Map<string, ToolCallRootRecord>();
    registry.set(messageId, messageRoots);
  }

  return messageRoots;
};

export const getMessageErrorBlockRoots = (messageId: string): Map<string, ToolCallRootRecord> => {
  const registry = getErrorBlockRegistry();
  let messageRoots = registry.get(messageId);

  if (!messageRoots) {
    messageRoots = new Map<string, ToolCallRootRecord>();
    registry.set(messageId, messageRoots);
  }

  return messageRoots;
};

export const cleanupStaleToolCallRoots = (now: number = Date.now()): void => {
  const registry = getRegistry();

  registry.forEach((messageRoots, messageId) => {
    messageRoots.forEach((record, toolCallId) => {
      if (record.container) {
        if (record.container.isConnected) {
          return;
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

export const cleanupStaleErrorBlockRoots = (now: number = Date.now()): void => {
  const registry = getErrorBlockRegistry();

  registry.forEach((messageRoots, messageId) => {
    messageRoots.forEach((record, errorId) => {
      if (record.container) {
        if (record.container.isConnected) {
          return;
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
