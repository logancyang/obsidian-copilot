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
import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import { cn } from "@/lib/utils";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { App } from "obsidian";
import { AlertTriangle, Check, CircleSlash, Loader2 } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

/** The app's animated sigma spinner, sized to sit inline with a status label. */
const ThinkingSpinner: React.FC = () => (
  <span className="tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center">
    <CopilotSpinner />
  </span>
);

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

/** One segmented-row tab: brand icon, label, and live status dot. */
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
        // Active tab: accent border + faint accent tint + normal-weight text,
        // matching AgentTabStrip's active-tab treatment. The accent border is the
        // reliable highlight; a background-only swap reads as "no active tab".
        selected
          ? "tw-border-interactive-accent tw-font-medium tw-text-normal tw-bg-interactive-accent/10"
          : "tw-text-muted hover:tw-bg-interactive-hover hover:tw-text-normal"
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

/** The trailing status indicator on an agent tab; the summary tab renders nothing. */
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
  if (state === "cancelled" || state === "empty") {
    return <CircleSlash className="tw-size-3 tw-shrink-0 tw-text-muted" />;
  }
  return null;
};

/**
 * Render a fan-out turn as one assistant turn: a segmented tab row (Summary
 * first, default) switching between the summary and each agent's answer, each
 * tab reflecting its live state. Renders for BOTH a live turn and a reloaded
 * composite. Controlled — the owning card holds the selected tab so its action
 * bar can Copy/Insert the tab in view.
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
 * The body for the current selection: the summary (or its placeholder), else the
 * chosen agent's answer — streaming, finished, an error chip, or a cancelled
 * state. Partial text that streamed before a failure/cancel is shown above the chip.
 */
const FanoutTurnBody: React.FC<FanoutTurnBodyProps> = ({ turn, value, app }) => {
  if (value === FANOUT_SUMMARY_OPTION) {
    if (turn.summary.text) {
      return <FanoutSlotBody text={turn.summary.text} app={app} />;
    }
    switch (summaryDisplayState(turn)) {
      case "writing":
        return <FanoutStatusLine icon={<ThinkingSpinner />} text="Writing summary…" shimmer />;
      case "waiting":
        return <FanoutStatusLine icon={<ThinkingSpinner />} text="Waiting for answers…" shimmer />;
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
          <FanoutStatusLine icon={<ThinkingSpinner />} text="Streaming…" shimmer />
        ) : null}
      </div>
    );
  }

  // Finished with no text — terminal "did not answer", NOT a spinner (a `done`
  // slot must never read as still thinking).
  if (answer.status === "done") {
    return (
      <FanoutStatusLine
        icon={<CircleSlash className="tw-size-4 tw-text-muted" />}
        text="This agent did not answer."
      />
    );
  }

  // Running with no text yet — the in-place thinking spinner.
  return <FanoutStatusLine icon={<ThinkingSpinner />} text="Thinking…" shimmer />;
};

interface FanoutSlotBodyProps {
  /** The selected slot's markdown text. */
  text: string;
  app: App;
}

/** The selected slot's rendered markdown; Copy/Insert lives on the card's action bar. */
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
 * A terminal (error/cancelled) agent body: any partial answer that streamed
 * before stopping, then the status chip, so a mid-stream stop discards no tokens.
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
  /** Animate the label with the shared running-gradient "thinking" shimmer. */
  shimmer?: boolean;
}

/** A small icon + label line used for streaming / pending / error states. */
const FanoutStatusLine: React.FC<FanoutStatusLineProps> = ({ icon, text, tone, shimmer }) => (
  <div
    className={cn(
      "tw-flex tw-items-center tw-gap-2 tw-p-1 tw-text-sm",
      tone === "error" ? "tw-text-error" : "tw-text-muted"
    )}
  >
    {icon}
    <span className={cn(shimmer && "copilot-shimmer-text")}>{text}</span>
  </div>
);
