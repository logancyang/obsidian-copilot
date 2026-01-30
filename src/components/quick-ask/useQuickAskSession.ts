/**
 * useQuickAskSession - Custom hook for managing Quick Ask chat session.
 * Handles conversation state and delegates streaming to shared hook.
 */

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
import { findCustomModel } from "@/utils";
import { logError, logWarn } from "@/logger";
import type { QuickAskMessage } from "./types";
import type { CopilotSettings } from "@/settings/model";

interface UseQuickAskSessionParams {
  selectedText: string;
  selectedModelKey: string;
  includeNoteContext: boolean;
  settings: CopilotSettings;
}

interface QuickAskSessionApi {
  messages: QuickAskMessage[];
  isStreaming: boolean;
  sendMessage: (inputText: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

/**
 * Hook for managing Quick Ask session state and streaming.
 */
export function useQuickAskSession(params: UseQuickAskSessionParams): QuickAskSessionApi {
  const { selectedText, selectedModelKey, includeNoteContext, settings } = params;

  // Message history (completed messages only)
  const [messages, setMessages] = useState<QuickAskMessage[]>([]);

  // Reason: Prevents setState calls after the component unmounts.
  // Without this guard, async operations (runTurn) that resolve after panel close
  // would trigger React warnings and potential state corruption.
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Safely resolve the selected model with fallback to first enabled model
  const resolvedModel = useMemo(() => {
    try {
      const model = findCustomModel(selectedModelKey, settings.activeModels);
      if (!model.enabled) {
        logWarn("Selected model is disabled; falling back to first enabled model.", {
          selectedModelKey,
        });
        return settings.activeModels.find((m) => m.enabled) ?? null;
      }
      return model;
    } catch {
      logWarn("Selected model not found; falling back to first enabled model.");
      return settings.activeModels.find((m) => m.enabled) ?? null;
    }
  }, [selectedModelKey, settings.activeModels]);

  // Use shared streaming hook
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

      // Add user message immediately for responsive UI
      // Reason: selectedText is now shown separately via SelectedContent component,
      // so displayContent no longer embeds <selected_text> XML tags.
      const userMessage: QuickAskMessage = {
        id: uuidv4(),
        role: "user",
        content: input,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Run the streaming turn
      const result = await runTurn(async (ctx: StreamingChatTurnContext) => {
        // Apply first-turn transforms
        let processedInput = input;
        if (ctx.isFirstTurn) {
          processedInput = appendIncludeNoteContextPlaceholders(input, includeNoteContext);
        }

        // Check abort before async operation
        if (ctx.signal.aborted) return "";

        // Process prompt (follow-up messages skip appending selected text)
        const prompt = await processCommandPrompt(processedInput, selectedText, !ctx.isFirstTurn);

        return prompt;
      });

      // Reason: If the panel was closed/unmounted during the async runTurn,
      // skip all state updates to avoid orphan setState calls.
      if (!isMountedRef.current) {
        return;
      }

      if (result) {
        // Add assistant message on success
        const assistantMessage: QuickAskMessage = {
          id: uuidv4(),
          role: "assistant",
          content: result,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        // Reason: If runTurn returns null, rollback the optimistically added
        // user message to avoid orphan messages. This covers:
        // - busy / re-entrancy (another turn in progress)
        // - no model configured
        // - empty prompt
        // - abort before streaming started
        // - reset() called (stale turn)
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === userMessage.id) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    },
    [includeNoteContext, runTurn, selectedText]
  );

  const stop = useCallback(() => {
    stopStreaming();
  }, [stopStreaming]);

  const clear = useCallback(() => {
    setMessages([]);
    reset();
  }, [reset]);

  // Compute display messages (include streaming content)
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
    messages: displayMessages,
    isStreaming,
    sendMessage,
    stop,
    clear,
  };
}
