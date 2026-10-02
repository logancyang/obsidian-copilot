import React, { useEffect, useRef, useState } from "react";
import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import type { ThoughtPart } from "@/agentMode/ui/agentTrail";

interface ReasoningBlockProps {
  part: ThoughtPart;
  isStreaming: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ part, isStreaming }) => {
  const fallbackStartedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  // Older saved parts have no timing metadata. They retain the prior local
  // fallback while live and render as `< 1s` once complete.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
  const startedAt = part.startedAtMs ?? fallbackStartedAtRef.current;
  const elapsedMs = part.durationMs ?? (isStreaming ? Math.max(0, now - startedAt) : 0);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  const steps = part.text
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <AgentReasoningBlock
      status={isStreaming ? "reasoning" : "complete"}
      elapsedSeconds={elapsedSeconds}
      steps={steps.length > 0 ? steps : [part.text]}
    />
  );
};
