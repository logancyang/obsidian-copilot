import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

/**
 * Animated spinner using a 7-dot sigma (Σ) pattern.
 * Dots light up in sequence with gradient trail (snake effect).
 *
 * Grid positions (3x3 grid, sigma shape):
 * 0 1 2
 *   4
 * 6 7 8
 *
 * Animation sequence (traces sigma shape):
 * 2 → 1 → 0 → 4 → 6 → 7 → 8 → (all dim) → repeat
 */
const CopilotSpinner: React.FC = () => {
  // Sigma pattern dots: [row, col, animation index]
  // Animation traces the sigma: top-right to top-left, down to center, then bottom-left to bottom-right
  const sigmaDots: { row: number; col: number; animIndex: number }[] = [
    { row: 0, col: 0, animIndex: 2 }, // top-left - 3rd
    { row: 0, col: 1, animIndex: 1 }, // top-center - 2nd
    { row: 0, col: 2, animIndex: 0 }, // top-right - 1st (leads)
    { row: 1, col: 1, animIndex: 3 }, // center - 4th
    { row: 2, col: 0, animIndex: 4 }, // bottom-left - 5th
    { row: 2, col: 1, animIndex: 5 }, // bottom-center - 6th
    { row: 2, col: 2, animIndex: 6 }, // bottom-right - 7th (last)
  ];

  const dotSize = 2.5;
  const gap = 3;
  const gridSize = dotSize * 3 + gap * 2;

  return (
    <svg
      width={gridSize}
      height={gridSize}
      viewBox={`0 0 ${gridSize} ${gridSize}`}
      className="copilot-spinner"
    >
      {sigmaDots.map((dot, index) => {
        const cx = dot.col * (dotSize + gap) + dotSize / 2;
        const cy = dot.row * (dotSize + gap) + dotSize / 2;

        return (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={dotSize / 2}
            // eslint-disable-next-line tailwindcss/no-custom-classname
            className={`copilot-spinner-dot copilot-spinner-dot-${dot.animIndex}`}
          />
        );
      })}
    </svg>
  );
};

/**
 * AgentReasoningBlock - Displays the agent's reasoning process
 *
 * This component replaces the old tool call banner with a more informative
 * reasoning display that shows:
 * - Active spinner during reasoning
 * - Elapsed time counter
 * - Current reasoning steps (last 2)
 * - Collapsible view after completion
 *
 * States:
 * - reasoning: Expanded, showing steps and active spinner
 * - collapsed: Collapsed after reasoning, before response
 * - complete: Response done, expandable to see steps
 */
export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedSeconds,
  steps,
  isStreaming,
}) => {
  const [isExpanded, setIsExpanded] = useState(status === "reasoning");

  // Auto-expand when reasoning, auto-collapse when done
  useEffect(() => {
    if (status === "reasoning") {
      setIsExpanded(true);
    } else if (status === "collapsed" || status === "complete") {
      setIsExpanded(false);
    }
  }, [status]);

  // Don't render anything if idle
  if (status === "idle") {
    return null;
  }

  const isActive = status === "reasoning";
  const canExpand = !isActive && steps.length > 0;

  return (
    <Collapsible
      open={canExpand ? isExpanded : isActive}
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
