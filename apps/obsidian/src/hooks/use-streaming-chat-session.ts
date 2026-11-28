import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunnableSequence } from "@langchain/core/runnables";
import type { BaseChatMemory } from "@langchain/classic/memory";

import type { CustomModel } from "@/aiParams";
import { createChatChain, createChatMemory } from "@/commands/customCommandChatEngine";
import { compactAssistantOutput } from "@/context/ChatHistoryCompactor";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { ABORT_REASON } from "@/constants";
import { logError } from "@/logger";
import { useRafThrottledCallback } from "@/hooks/use-raf-throttled-callback";

export interface StreamingChatTurnContext {
  signal: AbortSignal;
  isFirstTurn: boolean;
}

export interface UseStreamingChatSessionParams {
  model: CustomModel | null;
  systemPrompt: string;
  excludeThinking?: boolean;
  onNoModel?: () => void;
  onNonAbortError?: (error: unknown) => void;
}

export interface StreamingChatSessionApi {
  isStreaming: boolean;
  streamingText: string;

  getIsFirstTurn: () => boolean;

  runTurn: (
    getPrompt: (ctx: StreamingChatTurnContext) => Promise<string>
  ) => Promise<string | null>;

  stop: (reason?: ABORT_REASON) => void;

  reset: () => void;

  getMemory: () => BaseChatMemory | null;

  getLatestStreamingText: () => string;
}

interface ChainAndMemory {
  chain: RunnableSequence;
  memory: BaseChatMemory;
}

function shouldSkipPersistOnAbort(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;

  const reason = signal.reason;
  if (typeof reason !== "string") return true;

  const typedReason = reason as ABORT_REASON;
  return typedReason === ABORT_REASON.NEW_CHAT || typedReason === ABORT_REASON.UNMOUNT;
}

export function useStreamingChatSession(
  params: UseStreamingChatSessionParams
): StreamingChatSessionApi {
  const { model, systemPrompt, excludeThinking = true, onNoModel, onNonAbortError } = params;

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const isMountedRef = useRef(true);
  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamingTextRef = useRef("");
  const hasSavedContextOnceRef = useRef(false);
  const turnIdRef = useRef(0);

  const onNoModelRef = useRef(onNoModel);
  const onNonAbortErrorRef = useRef(onNonAbortError);
  useEffect(() => {
    onNoModelRef.current = onNoModel;
    onNonAbortErrorRef.current = onNonAbortError;
  }, [onNoModel, onNonAbortError]);

  const memoryRef = useRef<BaseChatMemory | null>(null);
  const chainRef = useRef<RunnableSequence | null>(null);
  const currentModelKeyRef = useRef<string | null>(null);
  const currentSystemPromptRef = useRef<string | null>(null);

  const modelKey = useMemo(() => model?.configuredModelId ?? null, [model]);

  const setStreamingTextThrottled = useRafThrottledCallback((text: string) => {
    if (!isMountedRef.current) return;
    setStreamingText(text);
  });

  const handleDelta = useCallback(
    (text: string): void => {
      if (!isMountedRef.current) return;
      streamingTextRef.current = text;
      setStreamingTextThrottled(text);
    },
    [setStreamingTextThrottled]
  );

  const getOrCreateChain = useCallback(
    async (signal: AbortSignal): Promise<ChainAndMemory | null> => {
      if (!model || !modelKey) {
        onNoModelRef.current?.();
        return null;
      }

      const needsRecreate =
        !chainRef.current ||
        currentModelKeyRef.current !== modelKey ||
        currentSystemPromptRef.current !== systemPrompt;

      if (needsRecreate) {
        if (!memoryRef.current) {
          memoryRef.current = createChatMemory();
        }

        const nextChain = await createChatChain(model, systemPrompt, memoryRef.current);

        if (signal.aborted) return null;

        chainRef.current = nextChain;
        currentModelKeyRef.current = modelKey;
        currentSystemPromptRef.current = systemPrompt;
      }

      if (!chainRef.current || !memoryRef.current) return null;
      return { chain: chainRef.current, memory: memoryRef.current };
    },
    [model, modelKey, systemPrompt]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort(ABORT_REASON.UNMOUNT);
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isStreamingRef.current) {
      abortControllerRef.current?.abort(ABORT_REASON.NEW_CHAT);
    }
    chainRef.current = null;
    currentModelKeyRef.current = null;
    currentSystemPromptRef.current = null;
  }, [modelKey, systemPrompt]);

  const getIsFirstTurn = useCallback((): boolean => {
    return !hasSavedContextOnceRef.current;
  }, []);

  const getMemory = useCallback((): BaseChatMemory | null => {
    return memoryRef.current;
  }, []);

  const getLatestStreamingText = useCallback((): string => {
    return streamingTextRef.current;
  }, []);

  const stop = useCallback((reason: ABORT_REASON = ABORT_REASON.USER_STOPPED): void => {
    abortControllerRef.current?.abort(reason);
  }, []);

  const reset = useCallback((): void => {
    abortControllerRef.current?.abort(ABORT_REASON.NEW_CHAT);
    abortControllerRef.current = null;

    chainRef.current = null;
    currentModelKeyRef.current = null;
    currentSystemPromptRef.current = null;

    memoryRef.current = createChatMemory();
    hasSavedContextOnceRef.current = false;

    turnIdRef.current += 1;

    streamingTextRef.current = "";
    isStreamingRef.current = false;

    if (isMountedRef.current) {
      setStreamingText("");
      setStreamingTextThrottled("");
      setIsStreaming(false);
    }
  }, [setStreamingTextThrottled]);

  const runTurn = useCallback(
    async (
      getPrompt: (ctx: StreamingChatTurnContext) => Promise<string>
    ): Promise<string | null> => {
      if (isStreamingRef.current) return null;

      isStreamingRef.current = true;
      if (isMountedRef.current) setIsStreaming(true);

      const currentTurnId = ++turnIdRef.current;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      streamingTextRef.current = "";
      if (isMountedRef.current) {
        setStreamingText("");
        setStreamingTextThrottled("");
      }

      const turnScopedDelta = (text: string): void => {
        if (turnIdRef.current !== currentTurnId) return;
        handleDelta(text);
      };

      const thinkStreamer = new ThinkBlockStreamer(turnScopedDelta, excludeThinking);

      let didNonAbortError = false;
      let memory: BaseChatMemory | null = null;
      let prompt = "";
      let committed: string | null = null;

      try {
        const isFirstTurn = !hasSavedContextOnceRef.current;

        if (!model) {
          onNoModelRef.current?.();
          return null;
        }

        prompt = await getPrompt({ signal: abortController.signal, isFirstTurn });
        if (abortController.signal.aborted) return null;

        if (!prompt.trim()) return null;

        const chainAndMemory = await getOrCreateChain(abortController.signal);
        if (!chainAndMemory) return null;

        memory = chainAndMemory.memory;

        const chainWithSignal = chainAndMemory.chain.withConfig({
          signal: abortController.signal,
        });
        const stream = await chainWithSignal.stream({ input: prompt });

        for await (const chunk of stream) {
          thinkStreamer.processChunk(chunk as Parameters<typeof thinkStreamer.processChunk>[0]);
          if (abortController.signal.aborted) break;
        }
      } catch (error) {
        const isAbort =
          (error instanceof Error && error.name === "AbortError") || abortController.signal.aborted;

        if (!isAbort) {
          didNonAbortError = true;
          onNonAbortErrorRef.current?.(error);
        }
      } finally {
        const result = thinkStreamer.close().content.trim();

        const shouldSkip = shouldSkipPersistOnAbort(abortController.signal);
        const isStale = turnIdRef.current !== currentTurnId;

        if (!didNonAbortError && result && !shouldSkip && !isStale) {
          committed = result;

          if (memory) {
            try {
              const compactedResult = compactAssistantOutput(result);
              await memory.saveContext(
                { input: prompt },
                { output: typeof compactedResult === "string" ? compactedResult : result }
              );
              hasSavedContextOnceRef.current = true;
            } catch (error) {
              logError("Error saving chat context:", error);
            }
          }
        }

        if (!isStale) {
          streamingTextRef.current = "";
          isStreamingRef.current = false;
        }

        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }

        if (isMountedRef.current && !isStale) {
          setStreamingText("");
          setStreamingTextThrottled("");
          setIsStreaming(false);
        }
      }

      return committed;
    },
    [excludeThinking, getOrCreateChain, handleDelta, model, setStreamingTextThrottled]
  );

  return {
    isStreaming,
    streamingText,
    getIsFirstTurn,
    runTurn,
    stop,
    reset,
    getMemory,
    getLatestStreamingText,
  };
}
