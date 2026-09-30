import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import {
  useStreamingChatSession,
  type StreamingChatTurnContext,
} from "@/hooks/use-streaming-chat-session";
import {
  QUICK_COMMAND_SYSTEM_PROMPT,
  appendIncludeNoteContextPlaceholders,
} from "@/commands/quickCommandPrompts";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { useApp } from "@/context";
import { useResolvedChatBackendModel } from "@/hooks/useResolvedChatBackendModel";
import { logError } from "@/logger";
import type { QuickAskMessage } from "./types";

interface UseQuickAskSessionParams {
  selectedText: string;
  selectedModelKey: string | undefined;
  includeNoteContext: boolean;
}

interface QuickAskSessionApi {
  hasModel: boolean;
  messages: QuickAskMessage[];
  isStreaming: boolean;
  sendMessage: (inputText: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useQuickAskSession(params: UseQuickAskSessionParams): QuickAskSessionApi {
  const app = useApp();
  const { selectedText, selectedModelKey, includeNoteContext } = params;

  const [messages, setMessages] = useState<QuickAskMessage[]>([]);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const resolvedModel = useResolvedChatBackendModel(app, selectedModelKey);

  const {
    isStreaming,
    streamingText,
    runTurn,
    stop: stopStreaming,
    reset,
  } = useStreamingChatSession({
    model: resolvedModel,
    systemPrompt: QUICK_COMMAND_SYSTEM_PROMPT,
    excludeThinking: true,
    onNoModel: () => {
      logError("No active model is configured. Please configure a model in Copilot settings.");
      new Notice("No active model configured. Please configure a model in Copilot settings.");
    },
    onNonAbortError: (error) => {
      logError("Error generating response:", error);
      new Notice("Error generating response. Please try again.");
    },
  });

  const sendMessage = useCallback(
    async (input: string) => {
      if (!input.trim()) return;

      const userMessage: QuickAskMessage = {
        id: uuidv4(),
        role: "user",
        content: input,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      const result = await runTurn(async (ctx: StreamingChatTurnContext) => {
        let processedInput = input;
        if (ctx.isFirstTurn) {
          processedInput = appendIncludeNoteContextPlaceholders(input, includeNoteContext);
        }

        if (ctx.signal.aborted) return "";

        const prompt = await processCommandPrompt(
          app,
          processedInput,
          selectedText,
          !ctx.isFirstTurn
        );

        return prompt;
      });

      if (!isMountedRef.current) {
        return;
      }

      if (result) {
        const assistantMessage: QuickAskMessage = {
          id: uuidv4(),
          role: "assistant",
          content: result,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === userMessage.id) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    },
    [app, includeNoteContext, runTurn, selectedText]
  );

  const stop = useCallback(() => {
    stopStreaming();
  }, [stopStreaming]);

  const clear = useCallback(() => {
    setMessages([]);
    reset();
  }, [reset]);

  const displayMessages = useMemo(() => {
    if (!isStreaming || !streamingText) return messages;
    return [
      ...messages,
      {
        id: "streaming",
        role: "assistant" as const,
        content: streamingText,
        timestamp: Date.now(),
      },
    ];
  }, [messages, isStreaming, streamingText]);

  return {
    hasModel: resolvedModel !== null,
    messages: displayMessages,
    isStreaming,
    sendMessage,
    stop,
    clear,
  };
}
