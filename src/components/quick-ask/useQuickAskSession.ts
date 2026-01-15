/**
 * useQuickAskSession - Custom hook for managing Quick Ask chat session.
 * Handles conversation state, streaming, and LLM chain management.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { RunnableSequence } from "@langchain/core/runnables";
import type { BufferMemory } from "@langchain/classic/memory";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { createChatMemory, createChatChain } from "@/commands/customCommandChatEngine";
import {
  QUICK_COMMAND_SYSTEM_PROMPT,
  appendIncludeNoteContextPlaceholders,
} from "@/commands/quickCommandPrompts";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { findCustomModel } from "@/utils";
import { logError } from "@/logger";
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
 * RAF-throttled callback hook for smooth streaming updates.
 */
function useRafThrottledCallback<T>(cb: (v: T) => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  const frameRef = useRef<number | null>(null);
  const latestRef = useRef<T | null>(null);

  return useCallback((v: T) => {
    latestRef.current = v;
    if (frameRef.current != null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (latestRef.current != null) cbRef.current(latestRef.current);
    });
  }, []);
}

/**
 * Hook for managing Quick Ask session state and streaming.
 */
export function useQuickAskSession(params: UseQuickAskSessionParams): QuickAskSessionApi {
  const { selectedText, selectedModelKey, includeNoteContext, settings } = params;

  // Message history (completed messages only)
  const [messages, setMessages] = useState<QuickAskMessage[]>([]);
  // Streaming content (separate for performance)
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Refs for chain management
  const memoryRef = useRef<BufferMemory | null>(null);
  const chainRef = useRef<RunnableSequence | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentSystemPromptRef = useRef<string | null>(null);
  const isFirstMessageRef = useRef(true);

  // Throttled streaming update
  const onDeltaThrottled = useRafThrottledCallback((text: string) => {
    setStreamingText(text);
  });

  // Reset chain when model changes
  useEffect(() => {
    chainRef.current = null;
    currentSystemPromptRef.current = null;
  }, [selectedModelKey]);

  const sendMessage = useCallback(
    async (input: string) => {
      if (!input.trim() || isStreaming) return;

      // 1. First message: append Include note context placeholders
      let processedInput = input;
      if (isFirstMessageRef.current) {
        processedInput = appendIncludeNoteContextPlaceholders(input, includeNoteContext);
        isFirstMessageRef.current = false;
      }

      // 2. Process prompt (follow-up messages skip appending selected text)
      const isFollowUp = messages.length > 0;
      const prompt = await processCommandPrompt(processedInput, selectedText, isFollowUp);

      // 3. Add user message
      // For first message with selected text, show the selected_text tag in display
      const displayContent =
        !isFollowUp && selectedText.trim()
          ? `<selected_text>\n${selectedText}\n</selected_text>\n\n${input}`
          : input;

      const userMessage: QuickAskMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: displayContent,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // 4. Start streaming
      setStreamingText("");
      setIsStreaming(true);

      // 5. Lazy create chain
      const systemPrompt = QUICK_COMMAND_SYSTEM_PROMPT;

      if (!chainRef.current || currentSystemPromptRef.current !== systemPrompt) {
        if (!memoryRef.current) {
          memoryRef.current = createChatMemory();
        }
        const model = findCustomModel(selectedModelKey, settings.activeModels);
        chainRef.current = await createChatChain(model, systemPrompt, memoryRef.current);
        currentSystemPromptRef.current = systemPrompt;
      }

      // 6. Stream response
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const chainWithSignal = chainRef.current.withConfig({
          signal: abortController.signal,
        });
        const stream = await chainWithSignal.stream({ input: prompt });

        // ThinkBlockStreamer: excludeThinking=true
        const thinkStreamer = new ThinkBlockStreamer(onDeltaThrottled, undefined, true);

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          thinkStreamer.processChunk(chunk);
        }

        const finalResult = thinkStreamer.close();

        if (!abortController.signal.aborted) {
          const result = finalResult.content.trim();
          await memoryRef.current!.saveContext({ input: prompt }, { output: result });

          const assistantMessage: QuickAskMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: result,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setStreamingText("");
        }
      } catch (error) {
        if ((error as Error).name === "AbortError" || abortController.signal.aborted) {
          // Aborted by user - keep partial content if available
          if (streamingText) {
            const partialMessage: QuickAskMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: streamingText,
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, partialMessage]);
            setStreamingText("");
          }
        } else {
          logError("Error generating response:", error);
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [
      isStreaming,
      includeNoteContext,
      messages.length,
      selectedText,
      selectedModelKey,
      settings.activeModels,
      onDeltaThrottled,
      streamingText,
    ]
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessages([]);
    setStreamingText("");
    memoryRef.current = createChatMemory();
    chainRef.current = null;
    currentSystemPromptRef.current = null;
    isFirstMessageRef.current = true;
  }, [stop]);

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
