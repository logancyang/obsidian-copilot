import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import React, { useEffect, useRef, useState } from "react";

interface RunningTurnDurationProps {
  status: "running";
  startedAtMs: number;
}

interface CompletedTurnDurationProps {
  status: "complete";
  durationMs: number;
}

type AgentTurnDurationIndicatorProps = RunningTurnDurationProps | CompletedTurnDurationProps;

/** Format elapsed turn time while preserving seconds and omitting leading zero units. */
export function formatWorkedDuration(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Shows whole-turn elapsed time, animating only while the agent is active and
 * retaining a quiet, static icon and duration after the turn completes.
 */
export const AgentTurnDurationIndicator: React.FC<AgentTurnDurationIndicatorProps> = (props) => {
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const isRunning = props.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const intervalWindow = rootRef.current?.win;
    if (!intervalWindow) return;
    const id = intervalWindow.setInterval(() => setNow(Date.now()), 1000);
    return () => intervalWindow.clearInterval(id);
  }, [isRunning]);

  const durationMs = isRunning ? Math.max(0, now - props.startedAtMs) : props.durationMs;

  return (
    <div
      ref={rootRef}
      className="tw-mb-2 tw-mt-1 tw-w-full tw-text-ui-medium max-md:tw-mb-1.5 max-md:tw-mt-0.5"
    >
      <div className="tw-flex tw-w-full tw-items-center tw-gap-1.5 tw-pl-1 tw-text-left tw-text-ui-small tw-text-muted">
        <span className="tw-flex tw-size-icon-xs tw-shrink-0 tw-items-center tw-justify-center">
          <CopilotSpinner animated={isRunning} />
        </span>
        <span>
          <span className={isRunning ? "copilot-shimmer-text tw-font-medium" : "tw-font-medium"}>
            Worked for
          </span>{" "}
          <span className="tw-tabular-nums">{formatWorkedDuration(durationMs)}</span>
        </span>
        {isRunning ? (
          <span className="tw-sr-only" role="status" aria-live="polite">
            Agent is working
          </span>
        ) : null}
      </div>
    </div>
  );
};
