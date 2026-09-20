import { cn } from "@/lib/utils";
import React from "react";

/** Map a 0–1 relevance score directly to the meter fill width. */
export function meterWidth(score: number): string {
  return `${Math.max(0, Math.min(100, score * 100))}%`;
}

/** Color-grade the meter: stronger matches lean fully into the theme accent. */
export function meterColor(score: number): string {
  const pct = score * 100;
  const k = Math.max(0, Math.min(1, (pct - 30) / 45));
  return `color-mix(in srgb, var(--interactive-accent) ${Math.round(40 + 60 * k)}%, var(--text-faint))`;
}

/** The shared score meter used wherever Copilot ranks note-like results. */
export function RelevanceMeter({
  score,
  animated,
  className,
}: {
  score: number;
  /** False when the reader has asked for reduced motion. */
  animated: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "tw-h-[3px] tw-w-full tw-overflow-hidden tw-rounded-full tw-bg-modifier-hover",
        className
      )}
    >
      <div
        className={cn(
          "copilot-relevance-meter-fill tw-h-full tw-rounded-full",
          // A live re-rank rewrites the score, and growing or shrinking the bar
          // is what makes a note's rising relevance readable as it happens.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
          animated && "tw-transition-[width,background-color] tw-duration-500 tw-ease-out"
        )}
        style={
          {
            "--relevance-meter-fill": meterWidth(score),
            "--relevance-meter-color": meterColor(score),
          } as React.CSSProperties
        }
      />
    </div>
  );
}
