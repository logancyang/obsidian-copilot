import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import { useSessionUsage } from "@/agentMode/ui/hooks/useSessionUsage";
import { TokenCounter } from "@/components/chat-components/TokenCounter";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
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

/** Compact token count: `<1k`, `12k`, `128k`, or the bare number under 1000. */
function formatTokens(count: number): string {
  if (count < 1000) return count.toLocaleString();
  return `${Math.round(count / 1000)}k`;
}

/** Session cost as USD; sub-cent values keep more precision so they read as non-zero. */
function formatUsd(costUsd: number): string {
  const fractionDigits = costUsd > 0 && costUsd < 0.01 ? 4 : 2;
  return costUsd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
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

/** One label/value row in the popover breakdown. */
function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
      <span className="tw-text-muted">{label}</span>
      <span className="tw-tabular-nums">{value}</span>
    </div>
  );
}

/** Full % ring + numbers popover, used when the context window is known. */
function RingMeter({ usage, contextWindow }: { usage: SessionUsage; contextWindow: number }) {
  // Guard a non-finite `usedTokens` (e.g. NaN from a malformed upstream value)
  // so it can't propagate into the rendered percent or the SVG dashoffset.
  const used = Number.isFinite(usage.usedTokens) ? usage.usedTokens : 0;
  const fraction = Math.min(1, Math.max(0, used / contextWindow));
  const percent = Math.round(fraction * 100);
  const isWarning = fraction >= WARNING_THRESHOLD;

  const cacheTokens = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  const breakdown: string[] = [];
  if (usage.inputTokens !== undefined) breakdown.push(`${formatTokens(usage.inputTokens)} in`);
  if (usage.outputTokens !== undefined) breakdown.push(`${formatTokens(usage.outputTokens)} out`);
  if (cacheTokens > 0) breakdown.push(`${formatTokens(cacheTokens)} cache`);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          className={cn("tw-gap-1", isWarning ? "tw-text-warning" : "tw-text-accent")}
          aria-label="Context usage"
        >
          <ContextRing fraction={fraction} />
          <span className="tw-text-ui-smaller tw-tabular-nums">{percent}%</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="tw-w-64">
        <div className="tw-flex tw-flex-col tw-gap-2">
          <div className="tw-flex tw-items-baseline tw-justify-between tw-gap-2">
            <span className="tw-font-medium">Context used</span>
            <span className={cn("tw-font-medium", isWarning && "tw-text-warning")}>{percent}%</span>
          </div>
          <UsageRow
            label="Tokens"
            value={`${usage.usedTokens.toLocaleString()} / ${contextWindow.toLocaleString()}`}
          />
          {breakdown.length > 0 && <UsageRow label="Breakdown" value={breakdown.join(" · ")} />}
          {usage.costUsd !== undefined && (
            <UsageRow label="Est. cost" value={formatUsd(usage.costUsd)} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Circular context-window meter for the agent composer. Renders the leading
 * `Separator` itself so the badge row has no dangling divider when it returns
 * `null`. Render ladder from the backend's {@link SessionUsage}:
 *
 *   - a positive `contextWindow` → the % ring + numbers popover (with cost);
 *   - `usedTokens` known but no window → the legacy count-only `TokenCounter`
 *     chip (no cost);
 *   - no usage at all → `null` (renders nothing).
 */
export default function AgentContextMeter({ backend }: AgentContextMeterProps) {
  const usage = useSessionUsage(backend);
  if (usage === null) return null;

  const window = usage.contextWindow;
  if (typeof window === "number" && Number.isFinite(window) && window > 0) {
    return (
      <>
        <Separator orientation="vertical" />
        <RingMeter usage={usage} contextWindow={window} />
      </>
    );
  }

  // Count-only fallback: render nothing (no separator, no chip) when there is
  // no usage to show, so the badge row keeps no dangling divider.
  if (!(usage.usedTokens > 0)) return null;
  return (
    <>
      <Separator orientation="vertical" />
      <TokenCounter tokenCount={usage.usedTokens} />
    </>
  );
}
