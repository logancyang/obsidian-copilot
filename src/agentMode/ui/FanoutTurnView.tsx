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
import { AgentGlyph } from "@/components/ui/AgentGlyph";
import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import { cn } from "@/lib/utils";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { App } from "obsidian";
import { AlertTriangle, Check, CircleSlash, Loader2 } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

const ThinkingSpinner: React.FC = () => (
  <span className="tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center">
    <CopilotSpinner />
  </span>
);

interface FanoutTurnViewProps {
  turn: FanoutTurn;
  app: App;
  value: FanoutOptionValue;
  onSelect: (value: FanoutOptionValue) => void;
}

interface FanoutTabProps {
  option: FanoutOption;
  selected: boolean;
  onSelect: (value: FanoutOptionValue) => void;
}

const FanoutTab: React.FC<FanoutTabProps> = ({ option, selected, onSelect }) => {
  const { value, icon, label, state } = option;
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
          ? "tw-border-interactive-accent tw-font-medium tw-text-normal tw-bg-interactive-accent/10"
          : "tw-text-muted hover:tw-bg-interactive-hover hover:tw-text-normal"
      )}
    >
      {icon === undefined ? null : <AgentGlyph name={label} />}
      <span className="tw-max-w-32 tw-truncate">{label}</span>
      <FanoutStatusDot state={state} />
    </button>
  );
};

interface FanoutStatusDotProps {
  state: FanoutAgentState | undefined;
}

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

const FanoutTurnBody: React.FC<FanoutTurnBodyProps> = ({ turn, value, app }) => {
  if (value === FANOUT_SUMMARY_OPTION) {
    // Partial summary text must not hide an actionable setup or stream failure.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
    if (turn.summary.error) {
      return (
        <FanoutTerminalState app={app} partialText={turn.summary.text}>
          <FanoutStatusLine
            icon={<AlertTriangle className="tw-size-4 tw-text-error" />}
            text={turn.summary.error}
            tone="error"
          />
        </FanoutTerminalState>
      );
    }
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

  if (answer.status === "done") {
    return (
      <FanoutStatusLine
        icon={<CircleSlash className="tw-size-4 tw-text-muted" />}
        text="This agent did not answer."
      />
    );
  }

  return <FanoutStatusLine icon={<ThinkingSpinner />} text="Thinking…" shimmer />;
};

interface FanoutSlotBodyProps {
  text: string;
  app: App;
}

const FanoutSlotBody: React.FC<FanoutSlotBodyProps> = ({ text, app }) => (
  <AgentMarkdownText text={text} app={app} />
);

interface FanoutTerminalStateProps {
  partialText: string;
  app: App;
  children: React.ReactNode;
}

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
  shimmer?: boolean;
}

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
