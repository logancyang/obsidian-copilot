import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import { formatDuration } from "@/lib/duration";
import { cn } from "@/lib/utils";
import { ReasoningStatus } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { Brain, ChevronRight } from "lucide-react";
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
    <Collapsible
      open={isExpanded}
      onOpenChange={canExpand ? setIsExpanded : undefined}
      disabled={!canExpand}
      className="tw-my-1 tw-flex tw-w-full tw-flex-col tw-gap-0.5"
    >
      <CollapsibleTrigger asChild disabled={!canExpand}>
        <div
          className={cn(
            "tw-flex tw-w-full tw-items-center tw-gap-1.5 tw-text-left tw-text-sm tw-text-muted hover:tw-text-normal",
            canExpand ? "tw-cursor-pointer" : "tw-cursor-default"
          )}
        >
          {/* Persistent identity icon: spinner while active, Brain when idle/complete */}
          <span className="tw-flex tw-size-3.5 tw-shrink-0 tw-items-center tw-justify-center">
            {isActive ? <CopilotSpinner /> : <Brain className="tw-size-3.5 tw-text-muted" />}
          </span>

          {/* Title and timer */}
          <span className="tw-font-medium">{isActive ? "Reasoning" : "Thought for"}</span>
          <span className="tw-text-muted">{formatDuration(elapsedSeconds * 1000)}</span>

          {canExpand && (
            <ChevronRight
              className={cn(
                "tw-ml-auto tw-size-3 tw-text-muted tw-transition-transform",
                isExpanded && "tw-rotate-90"
              )}
            />
          )}
        </div>
      </CollapsibleTrigger>

      {/* Steps - visible when expanded or actively reasoning */}
      <CollapsibleContent>
        {steps.length > 0 && (
          <ul className="tw-mt-1 tw-list-outside tw-list-disc tw-space-y-1.5 tw-pl-5 max-md:tw-space-y-1">
            {steps.map((step, i) => (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- steps are append-only with no stable id; text may repeat
              <li key={i} className="tw-text-xs tw-leading-[1.4] tw-text-muted">
                {step}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
