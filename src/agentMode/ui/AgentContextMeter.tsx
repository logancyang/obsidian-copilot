import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { withoutExpiredWindows } from "@/agentMode/session/planUsage";
import type { PlanUsage, SessionUsage } from "@/agentMode/session/types";
import { usePlanUsage } from "@/agentMode/ui/hooks/usePlanUsage";
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

/**
 * `resets in 2h 14m` — coarse on purpose. These windows run for hours or days, so
 * ticking seconds would be noise, and this does not re-render on a timer. Returns null
 * once the reset is in the past rather than counting up.
 */
function formatResetsIn(resetsAt: number | undefined, now: number): string | null {
  if (resetsAt === undefined) return null;
  const ms = resetsAt - now;
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `resets in ${hours}h` : `resets in ${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `resets in ${days}d` : `resets in ${days}d ${restHours}h`;
}

/**
 * The account's plan caps, one row per window. They sit under the context bar because
 * they answer a different question: the context bar is about this conversation, these
 * are about how much of the plan is left before work stops entirely.
 */
function PlanUsageRows({ planUsage }: { planUsage: PlanUsage }) {
  const now = Date.now();
  // Filtered at render, not only when a snapshot arrives or replays: a chat left open
  // across a reset gets no new event to correct it, and this component mounts fresh
  // each time the tooltip opens, so rendering is the last moment the claim is made and
  // the right place to check it
  // (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
  const current = withoutExpiredWindows(planUsage, now);
  if (!current) return null;
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {current.windows.map((window) => {
        const resetsIn = formatResetsIn(window.resetsAt, now);
        const percent = Math.round(window.percent);
        const isWarning = window.percent >= WARNING_THRESHOLD * 100;
        return (
          <div key={window.id} className="tw-flex tw-flex-col tw-gap-1">
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
              <span className="tw-whitespace-nowrap tw-text-muted">
                {window.label}
                {resetsIn && <span className="tw-text-faint"> · {resetsIn}</span>}
              </span>
              <span
                className={cn(
                  "tw-whitespace-nowrap tw-tabular-nums",
                  isWarning && "tw-text-warning"
                )}
              >
                {percent}%
              </span>
            </div>
            {/* Clamped for the bar only — a bar cannot render past full, while the
                number above it still shows the real figure for an account being
                served past its cap. */}
            <Progress value={Math.min(100, percent)} className="tw-h-1.5" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The meter itself: a trigger in the control row, and a hover tooltip holding a context
 * row plus any plan-cap rows.
 *
 * `contextWindow` is optional because not every backend reports one. When it is absent
 * the context row falls back to a bare token count, and the plan caps still render —
 * they are account-level and do not depend on knowing the window.
 */
export interface UsageMeterProps {
  usage: SessionUsage | null;
  contextWindow: number | null;
  planUsage: PlanUsage | null;
}

export function UsageMeter({ usage, contextWindow, planUsage }: UsageMeterProps) {
  // Guard a non-finite `usedTokens` (e.g. NaN from a malformed upstream value)
  // so it can't propagate into the rendered percent or the SVG dashoffset.
  const used = usage && Number.isFinite(usage.usedTokens) ? usage.usedTokens : 0;
  const fraction = contextWindow ? Math.min(1, Math.max(0, used / contextWindow)) : 0;
  const percent = Math.round(fraction * 100);
  const isWarning = contextWindow !== null && fraction >= WARNING_THRESHOLD;

  // Radix Tooltip handles hover/focus open/close and hoverable content natively,
  // so no manual open state or close timer is needed.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          className={cn(isWarning ? "tw-text-warning" : "tw-text-accent")}
          aria-label="Usage"
        >
          {contextWindow !== null ? <ContextRing fraction={fraction} /> : formatTokens(used)}
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" side="top" className="tw-w-80">
        <div className="tw-flex tw-flex-col tw-gap-2">
          {usage && (
            <>
              <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
                <span className="tw-whitespace-nowrap tw-text-muted">Context window</span>
                <span
                  className={cn(
                    "tw-whitespace-nowrap tw-tabular-nums",
                    isWarning && "tw-text-warning"
                  )}
                >
                  {contextWindow !== null
                    ? `${formatTokens(used)} / ${formatTokens(contextWindow)} (${percent}%)`
                    : formatTokens(used)}
                </span>
              </div>
              {contextWindow !== null && <Progress value={percent} className="tw-h-1.5" />}
            </>
          )}
          {planUsage && <PlanUsageRows planUsage={planUsage} />}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Usage meter for the agent control bar: a single icon-sized control beside the other
 * row buttons, whose tooltip carries the session's context occupancy and the account's
 * plan caps.
 *
 * The two are independent. A backend can report a context window with no caps (a key-
 * authenticated Claude session), caps with no window (Copilot Plus models, whose window
 * the agent does not advertise), both, or neither. Each is rendered when present, so
 * caps are never dropped just because there is nothing to measure the context against.
 *
 * With nothing to report the control disappears rather than showing an empty meter.
 */
export default function AgentContextMeter({ backend }: AgentContextMeterProps) {
  const usage = useSessionUsage(backend);
  const planUsage = usePlanUsage(backend);

  const rawWindow = usage?.contextWindow;
  const contextWindow =
    typeof rawWindow === "number" && Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : null;
  const hasTokens = usage !== null && usage.usedTokens > 0;

  if (contextWindow !== null || planUsage !== null) {
    return (
      <UsageMeter
        usage={hasTokens || contextWindow !== null ? usage : null}
        contextWindow={contextWindow}
        planUsage={planUsage}
      />
    );
  }

  // Nothing but a raw count to show: the long-standing count-only chip.
  if (!hasTokens) return null;
  return <TokenCounter tokenCount={usage.usedTokens} />;
}
