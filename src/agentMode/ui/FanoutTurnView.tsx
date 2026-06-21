import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import {
  buildFanoutOptions,
  FANOUT_SUMMARY_OPTION,
  selectedAnswer,
  summaryDisplayState,
  type FanoutAgentState,
  type FanoutOption,
  type FanoutOptionValue,
} from "@/agentMode/ui/fanoutDropdown";
import { cn } from "@/lib/utils";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { App } from "obsidian";
import { AlertTriangle, Check, CircleSlash, Loader2 } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

interface FanoutTurnViewProps {
  /** Fan-out turn for a multi-agent assistant message (live or reloaded). */
  turn: FanoutTurn;
  app: App;
  /** Selected tab — controlled by the card so its action bar can copy/insert it. */
  value: FanoutOptionValue;
  onSelect: (value: FanoutOptionValue) => void;
}

interface FanoutTabProps {
  option: FanoutOption;
  selected: boolean;
  onSelect: (value: FanoutOptionValue) => void;
}

/**
 * One segmented-row tab: the agent brand icon (summary tab has none) plus a
 * live status dot, and the label. Selecting it switches the body below.
 */
const FanoutTab: React.FC<FanoutTabProps> = ({ option, selected, onSelect }) => {
  const { value, Icon, label, state } = option;
  const handleClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={handleClick}
      className={cn(
        "tw-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-solid tw-border-transparent tw-px-2 tw-py-1 tw-text-sm tw-transition-colors",
        selected
          ? "tw-bg-interactive-accent tw-text-on-accent"
          : "tw-text-muted hover:tw-bg-interactive-hover"
      )}
    >
      {Icon ? <Icon className="tw-size-4 tw-shrink-0" /> : null}
      <span className="tw-max-w-32 tw-truncate">{label}</span>
      <FanoutStatusDot state={state} />
    </button>
  );
};

interface FanoutStatusDotProps {
  /** Agent live state; `undefined` for the summary tab (it has its own state). */
  state: FanoutAgentState | undefined;
}

/**
 * The trailing live status indicator on an agent tab: a spinner while
 * streaming, a check when the answer is done, an alert on error, a muted slash
 * when cancelled. The summary tab carries no agent state and renders nothing.
 */
const FanoutStatusDot: React.FC<FanoutStatusDotProps> = ({ state }) => {
  if (state === "streaming") {
    return <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />;
  }
  if (state === "answer") {
    return <Check className="tw-size-3 tw-shrink-0 tw-text-success" />;
  }
  if (state === "error") {
    return <AlertTriangle className="tw-size-3 tw-shrink-0 tw-text-error" />;
  }
  if (state === "cancelled") {
    return <CircleSlash className="tw-size-3 tw-shrink-0 tw-text-muted" />;
  }
  return null;
};

/**
 * Render a multi-agent fan-out turn as one assistant turn: a segmented tab row
 * (D8) — Summary first and selected by default — that switches between the main
 * agent's narrative summary and each participating agent's full answer. Each
 * agent tab reflects its live state (D7) via a status dot (spinner / check /
 * alert / slash) and updates live as `turn` changes. The selected slot's
 * markdown renders below; Copy/Insert for it live on the card's action bar.
 *
 * Drives off `message.fanout`, so it renders for BOTH the live in-flight turn
 * and a reloaded transcript whose composite body was parsed back into a turn.
 * Controlled: the owning card holds the selected tab so its single action-bar
 * Copy/Insert can act on exactly the tab in view.
 */
export const FanoutTurnView: React.FC<FanoutTurnViewProps> = memo(
  ({ turn, app, value, onSelect }) => {
    const options = useMemo(() => buildFanoutOptions(turn), [turn]);

    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        <div role="tablist" aria-label="Agent answers" className="tw-flex tw-flex-wrap tw-gap-1">
          {options.map((option) => (
            <FanoutTab
              key={option.value}
              option={option}
              selected={option.value === value}
              onSelect={onSelect}
            />
          ))}
        </div>
        <FanoutTurnBody turn={turn} value={value} app={app} />
      </div>
    );
  }
);
FanoutTurnView.displayName = "FanoutTurnView";

interface FanoutTurnBodyProps {
  turn: FanoutTurn;
  value: FanoutOptionValue;
  app: App;
}

/**
 * The body for the current selection: the summary (or its pending/streaming
 * placeholder) when the summary is selected, otherwise the chosen agent's
 * answer — streaming tokens with a spinner, the finished answer, an error chip
 * with a short reason (incl. per-agent timeouts), or a muted cancelled state
 * when the user aborted the turn. Any partial text that streamed before a
 * failure/cancel is still shown above the chip so nothing is lost.
 */
const FanoutTurnBody: React.FC<FanoutTurnBodyProps> = ({ turn, value, app }) => {
  if (value === FANOUT_SUMMARY_OPTION) {
    if (turn.summary.text) {
      return <FanoutSlotBody text={turn.summary.text} app={app} />;
    }
    switch (summaryDisplayState(turn)) {
      case "writing":
        return (
          <FanoutStatusLine
            icon={<Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />}
            text="Writing summary…"
          />
        );
      case "waiting":
        return (
          <FanoutStatusLine
            icon={<Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />}
            text="Waiting for answers…"
          />
        );
      case "cancelled":
        return (
          <FanoutStatusLine
            icon={<CircleSlash className="tw-size-4 tw-text-muted" />}
            text="Summary cancelled"
          />
        );
      case "unavailable":
        return (
          <FanoutStatusLine
            icon={<AlertTriangle className="tw-size-4 tw-text-error" />}
            text="Summary unavailable"
            tone="error"
          />
        );
    }
  }

  const answer = selectedAnswer(turn, value);
  if (!answer) return null;

  if (answer.status === "error" || answer.status === "cancelled") {
    const isError = answer.status === "error";
    return (
      <FanoutTerminalState app={app} partialText={answer.text}>
        <FanoutStatusLine
          icon={
            isError ? (
              <AlertTriangle className="tw-size-4 tw-text-error" />
            ) : (
              <CircleSlash className="tw-size-4 tw-text-muted" />
            )
          }
          text={isError ? answer.error?.trim() || "This agent failed to answer." : "Cancelled"}
          tone={isError ? "error" : undefined}
        />
      </FanoutTerminalState>
    );
  }

  if (answer.text) {
    return (
      <div className="tw-flex tw-flex-col tw-gap-1">
        <FanoutSlotBody text={answer.text} app={app} />
        {answer.status === "running" ? (
          <FanoutStatusLine
            icon={<Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />}
            text="Streaming…"
          />
        ) : null}
      </div>
    );
  }

  // Running with no text yet — the in-place thinking spinner.
  return (
    <FanoutStatusLine
      icon={<Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />}
      text="Thinking…"
    />
  );
};

interface FanoutSlotBodyProps {
  /** The selected slot's markdown text. */
  text: string;
  app: App;
}

/**
 * The selected slot's rendered markdown. Copy/Insert for the slot in view lives
 * on the card's single action bar (it acts on whichever tab is selected), so the
 * body carries no copy control of its own.
 */
const FanoutSlotBody: React.FC<FanoutSlotBodyProps> = ({ text, app }) => (
  <AgentMarkdownText text={text} app={app} />
);

interface FanoutTerminalStateProps {
  /** Whatever prose streamed before the agent errored or was cancelled. */
  partialText: string;
  app: App;
  children: React.ReactNode;
}

/**
 * A terminal (error/cancelled) agent body: render any partial answer that
 * streamed before the agent stopped, then the status chip below it, so a
 * mid-stream failure or cancel never discards the tokens already received.
 */
const FanoutTerminalState: React.FC<FanoutTerminalStateProps> = ({
  partialText,
  app,
  children,
}) => {
  if (!partialText.trim()) return <>{children}</>;
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <AgentMarkdownText text={partialText} app={app} />
      {children}
    </div>
  );
};

interface FanoutStatusLineProps {
  icon: React.ReactNode;
  text: string;
  tone?: "error";
}

/** A small icon + label line used for streaming / pending / error states. */
const FanoutStatusLine: React.FC<FanoutStatusLineProps> = ({ icon, text, tone }) => (
  <div
    className={cn(
      "tw-flex tw-items-center tw-gap-2 tw-p-1 tw-text-sm",
      tone === "error" ? "tw-text-error" : "tw-text-muted"
    )}
  >
    {icon}
    <span>{text}</span>
  </div>
);
