import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import { useSessionUsage } from "@/agentMode/ui/hooks/useSessionUsage";
import { TokenCounter } from "@/components/chat-components/TokenCounter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as React from "react";

interface AgentContextMeterProps {
  backend: AgentChatBackend;
}

/** Usage fraction at/above which the ring flips to the warning color. */
const WARNING_THRESHOLD = 0.85;

/** SVG donut geometry — sized to match the composer's `tw-size-4` glyphs. */
const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** One-decimal token count with a k/M suffix (e.g. `248.0k`, `1.0M`). */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toLocaleString();
}

/** SVG donut whose arc fills to `fraction` (0–1). Color comes from `currentColor`. */
function ContextRing({ fraction }: { fraction: number }) {
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);
  return (
    <svg
      className="tw-size-4 -tw-rotate-90"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx={8}
        cy={8}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="tw-opacity-20"
      />
      <circle
        cx={8}
        cy={8}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
}

/** Full % ring trigger + a horizontal context-window bar in a hover tooltip. */
function RingMeter({ usage, contextWindow }: { usage: SessionUsage; contextWindow: number }) {
  // Guard a non-finite `usedTokens` (e.g. NaN from a malformed upstream value)
  // so it can't propagate into the rendered percent or the SVG dashoffset.
  const used = Number.isFinite(usage.usedTokens) ? usage.usedTokens : 0;
  const fraction = Math.min(1, Math.max(0, used / contextWindow));
  const percent = Math.round(fraction * 100);
  const isWarning = fraction >= WARNING_THRESHOLD;

  // Radix Tooltip handles hover/focus open/close and hoverable content natively,
  // so no manual open state or close timer is needed.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          className={cn(isWarning ? "tw-text-warning" : "tw-text-accent")}
          aria-label="Context usage"
        >
          <ContextRing fraction={fraction} />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" side="top" className="tw-w-80">
        <div className="tw-flex tw-flex-col tw-gap-2">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
            <span className="tw-whitespace-nowrap tw-text-muted">Context window</span>
            <span
              className={cn("tw-whitespace-nowrap tw-tabular-nums", isWarning && "tw-text-warning")}
            >
              {formatTokens(used)} / {formatTokens(contextWindow)} ({percent}%)
            </span>
          </div>
          <Progress value={percent} className="tw-h-1.5" />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Circular context-window meter for the agent control bar. Renders as a single
 * icon-sized button that sits alongside the other row controls (no separator of
 * its own). Render ladder from the backend's {@link SessionUsage}:
 *
 *   - a positive `contextWindow` → the % ring with a hover tooltip (the
 *     percentage and token numbers live inside the tooltip);
 *   - `usedTokens` known but no window → the legacy count-only `TokenCounter`
 *     chip;
 *   - no usage at all → `null` (renders nothing, so the row shows no control).
 */
export default function AgentContextMeter({ backend }: AgentContextMeterProps) {
  const usage = useSessionUsage(backend);
  if (usage === null) return null;

  const window = usage.contextWindow;
  if (typeof window === "number" && Number.isFinite(window) && window > 0) {
    return <RingMeter usage={usage} contextWindow={window} />;
  }

  // Count-only fallback: render nothing when there is no usage to show.
  if (!(usage.usedTokens > 0)) return null;
  return <TokenCounter tokenCount={usage.usedTokens} />;
}
