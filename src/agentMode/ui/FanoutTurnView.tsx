import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import {
  buildFanoutOptions,
  defaultFanoutOption,
  FANOUT_SUMMARY_OPTION,
  selectedAnswer,
  type FanoutAgentState,
  type FanoutOption,
  type FanoutOptionValue,
} from "@/agentMode/ui/fanoutDropdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { App } from "obsidian";
import { AlertTriangle, CircleSlash, Loader2 } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";

interface FanoutTurnViewProps {
  /** Live fan-out turn for the active multi-agent assistant message. */
  turn: FanoutTurn;
  app: App;
}

interface FanoutOptionRowProps {
  option: FanoutOption;
}

/** A single dropdown row: brand icon (or live spinner / error glyph) + label. */
const FanoutOptionRow: React.FC<FanoutOptionRowProps> = ({ option }) => {
  const { Icon, label, state } = option;
  return (
    <span className="tw-flex tw-items-center tw-gap-2">
      <FanoutOptionGlyph Icon={Icon} state={state} />
      <span className="tw-truncate">{label}</span>
    </span>
  );
};

interface FanoutOptionGlyphProps {
  Icon: FanoutOption["Icon"];
  state: FanoutAgentState | undefined;
}

/**
 * The leading glyph for a row: a spinner while the agent streams, a warning
 * triangle on error, a muted slash when cancelled, otherwise the brand icon.
 * The summary row (no `Icon`, no `state`) renders nothing.
 */
const FanoutOptionGlyph: React.FC<FanoutOptionGlyphProps> = ({ Icon, state }) => {
  if (state === "streaming") {
    return <Loader2 className="tw-size-4 tw-shrink-0 tw-animate-spin tw-text-loading" />;
  }
  if (state === "error") {
    return <AlertTriangle className="tw-size-4 tw-shrink-0 tw-text-error" />;
  }
  if (state === "cancelled") {
    return <CircleSlash className="tw-size-4 tw-shrink-0 tw-text-muted" />;
  }
  if (Icon) return <Icon className="tw-size-4 tw-shrink-0" />;
  return null;
};

/**
 * Render a multi-agent fan-out turn as one assistant turn: a summary-first
 * dropdown (D8) that switches between the main agent's narrative summary and
 * each participating agent's full answer. Each agent entry reflects its live
 * state (D7) — a spinner while streaming, the answer when done, an error chip
 * on failure — and updates live as `turn` changes (the parent re-renders this
 * component, and only this component, per streamed token).
 *
 * Only the active/live turn renders this rich view. A reloaded multi-agent turn
 * persists as a plain summary-only assistant message (no live fan-out state),
 * so it never reaches here — it renders through the normal assistant path.
 */
export const FanoutTurnView: React.FC<FanoutTurnViewProps> = memo(({ turn, app }) => {
  const options = useMemo(() => buildFanoutOptions(turn), [turn]);
  const [selected, setSelected] = useState<FanoutOptionValue>(() => defaultFanoutOption(turn));

  // If the selected agent's slot disappears (defensive — slots are stable
  // within a turn), fall back to the summary rather than rendering nothing.
  const activeValue =
    selected !== FANOUT_SUMMARY_OPTION && !turn.answers[selected]
      ? FANOUT_SUMMARY_OPTION
      : selected;

  const handleChange = useCallback((value: string) => {
    setSelected(value);
  }, []);

  const selectedOption = options.find((o) => o.value === activeValue);

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <Select value={activeValue} onValueChange={handleChange}>
        <SelectTrigger className="tw-w-fit tw-min-w-40" aria-label="Select agent answer">
          <SelectValue>
            {selectedOption ? <FanoutOptionRow option={selectedOption} /> : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <FanoutOptionRow option={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FanoutTurnBody turn={turn} value={activeValue} app={app} />
    </div>
  );
});
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
    const summary = turn.summary;
    if (summary.text) return <AgentMarkdownText text={summary.text} app={app} />;
    return (
      <FanoutStatusLine
        icon={<Loader2 className="tw-size-4 tw-animate-spin tw-text-loading" />}
        text={summary.status === "pending" ? "Waiting for answers…" : "Writing summary…"}
      />
    );
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
        <AgentMarkdownText text={answer.text} app={app} />
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
