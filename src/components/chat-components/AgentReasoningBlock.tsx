import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import { cn } from "@/lib/utils";
import { ReasoningStatus } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { ChevronRight } from "lucide-react";
import React, { useEffect, useState } from "react";

/**
 * Props for the AgentReasoningBlock component
 */
interface AgentReasoningBlockProps {
  status: ReasoningStatus;
  elapsedSeconds: number;
  steps: string[];
  isStreaming: boolean;
}

/**
 * Formats elapsed time into a human-readable string
 *
 * @param seconds - Elapsed time in seconds
 * @returns Formatted time string (e.g., "9s" or "1m 30s")
 */
const formatTime = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedSeconds,
  steps,
  isStreaming,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-collapse when reasoning ends. (We default to collapsed and never
  // auto-expand — the user must click to peek at live or finished steps.)
  useEffect(() => {
    if (status === "collapsed" || status === "complete") {
      setIsExpanded(false);
    }
  }, [status]);

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
      className="agent-reasoning-block"
    >
      <CollapsibleTrigger asChild disabled={!canExpand}>
        <div
          className={cn(
            "agent-reasoning-header",
            canExpand && "tw-cursor-pointer",
            !canExpand && "tw-cursor-default"
          )}
        >
          {/* Spinner or expand chevron */}
          <span className="agent-reasoning-icon">
            {isActive ? (
              <CopilotSpinner />
            ) : (
              <ChevronRight
                className={cn(
                  "tw-size-3 tw-text-muted tw-transition-transform",
                  isExpanded && "tw-rotate-90"
                )}
              />
            )}
          </span>

          {/* Title and timer */}
          <span className="agent-reasoning-title">{isActive ? "Reasoning" : "Thought for"}</span>
          <span className="agent-reasoning-timer">{formatTime(elapsedSeconds)}</span>
        </div>
      </CollapsibleTrigger>

      {/* Steps - visible when expanded or actively reasoning */}
      <CollapsibleContent>
        {steps.length > 0 && (
          <ul className="agent-reasoning-steps">
            {steps.map((step, i) => (
              <li key={i} className="agent-reasoning-step">
                {step}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default AgentReasoningBlock;
