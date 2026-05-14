import React, { useEffect, useRef, useState } from "react";
import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import type { ThoughtPart } from "@/agentMode/ui/agentTrail";

interface ReasoningBlockProps {
  part: ThoughtPart;
  /** True when this part belongs to the actively streaming assistant
   *  message — drives the spinner + live timer. */
  isStreaming: boolean;
}

/**
 * Adapter that maps an agent-mode `thought` part onto the existing
 * `AgentReasoningBlock` UI (spinner, timer, collapse-on-done). The store
 * folds streamed `agent_thought_chunk`s into a single `thought` part, so
 * we have one part per assistant turn — `steps` derives from paragraph
 * splits within `part.text`.
 */
export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ part, isStreaming }) => {
  const startedAtRef = useRef<number | null>(null);
  const frozenAtRef = useRef<number | null>(null);
  const prevIsStreamingRef = useRef(isStreaming);
  const [now, setNow] = useState(() => Date.now());

  // Initialize start timestamp on first mount when the thought has content.
  useEffect(() => {
    if (startedAtRef.current === null && part.text.length > 0) {
      startedAtRef.current = Date.now();
    }
  }, [part.text]);

  // Derive the freeze timestamp during render so we don't render one frame
  // with `isStreaming=false` and a still-null completion mark. Mutating a
  // ref during render is safe as long as the result is deterministic for
  // this set of inputs.
  if (prevIsStreamingRef.current !== isStreaming) {
    if (!isStreaming && startedAtRef.current !== null) {
      frozenAtRef.current = Date.now();
    } else if (isStreaming) {
      frozenAtRef.current = null;
    }
    prevIsStreamingRef.current = isStreaming;
  }

  // Tick the clock while streaming.
  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  const frozenAt = frozenAtRef.current;

  const startedAt = startedAtRef.current ?? Date.now();
  const endedAt = frozenAt ?? (isStreaming ? now : startedAt);
  const elapsedSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));

  const steps = part.text
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <AgentReasoningBlock
      status={isStreaming ? "reasoning" : "complete"}
      elapsedSeconds={elapsedSeconds}
      steps={steps.length > 0 ? steps : [part.text]}
      isStreaming={isStreaming}
    />
  );
};
