import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { formatDuration } from "@/lib/duration";
import { ReasoningStatus } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { Brain } from "lucide-react";
import React, { useState } from "react";

interface AgentReasoningBlockProps {
  status: ReasoningStatus;
  elapsedSeconds: number;
  steps: string[];
  isStreaming: boolean;
}

export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedSeconds,
  steps,
  isStreaming,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [prevStatus, setPrevStatus] = useState(status);

  // Auto-collapse when reasoning ends. (We default to collapsed and never
  // auto-expand — the user must click to peek at live or finished steps.)
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "collapsed" || status === "complete") {
      setIsExpanded(false);
    }
  }

  // Don't render anything if idle
  if (status === "idle") {
    return null;
  }

  const isActive = status === "reasoning";
  const canExpand = steps.length > 0;

  return (
    <AgentActivityCard
      icon={Brain}
      label={
        <>
          <span>
            {isActive ? (
              <>
                Reasoning
                <span className="copilot-shimmer-text" aria-hidden="true">
                  ...
                </span>
              </>
            ) : (
              "Thought for"
            )}
          </span>
          {!isActive ? (
            <span className="tw-font-normal tw-text-muted">
              {formatDuration(elapsedSeconds * 1000)}
            </span>
          ) : null}
        </>
      }
      expandable={canExpand}
      open={isExpanded}
      onToggle={() => setIsExpanded((expanded) => !expanded)}
    >
      <ul className="tw-list-outside tw-list-disc tw-space-y-1.5 tw-pl-4 max-md:tw-space-y-1">
        {steps.map((step, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- steps are append-only with no stable id; text may repeat
          <li key={i} className="tw-text-xs tw-leading-[1.4] tw-text-muted">
            {step}
          </li>
        ))}
      </ul>
    </AgentActivityCard>
  );
};
