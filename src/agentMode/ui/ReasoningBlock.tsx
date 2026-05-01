import React, { useEffect, useRef, useState } from "react";
import AgentReasoningBlock from "@/components/chat-components/AgentReasoningBlock";
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
  // State (not ref) so the freeze triggers a re-render — without it the
  // component renders one frame with `isStreaming=false` and a still-null
  // completion mark, collapsing the timer to "0s" and never recovering.
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Initialize start timestamp on first mount when the thought has content.
  useEffect(() => {
    if (startedAtRef.current === null && part.text.length > 0) {
      startedAtRef.current = Date.now();
    }
  }, [part.text]);

  // Freeze elapsed time when streaming flips off; reset when it resumes.
  useEffect(() => {
    if (!isStreaming && frozenAt === null && startedAtRef.current !== null) {
      setFrozenAt(Date.now());
    }
    if (isStreaming && frozenAt !== null) {
      setFrozenAt(null);
    }
  }, [isStreaming, frozenAt]);

  // Tick the clock while streaming.
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const startedAt = startedAtRef.current ?? Date.now();
  const endedAt = frozenAt ?? (isStreaming ? now : startedAt);
  const elapsedSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));

  const steps = part.text
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <div className="tw-my-1">
      <AgentReasoningBlock
        status={isStreaming ? "reasoning" : "complete"}
        elapsedSeconds={elapsedSeconds}
        steps={steps.length > 0 ? steps : [part.text]}
        isStreaming={isStreaming}
      />
    </div>
  );
};
