import type { AgentMention } from "@/agents/agentMentions";
import {
  formatRunTime,
  mentionStatusLine,
  type MentionStatusTone,
} from "@/agents/agentMentionStatus";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { cn } from "@/lib/utils";
import { CircleAlert, CircleCheck, CircleHelp, CircleStop, Loader2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

const TONE_CLASS: Record<MentionStatusTone, string> = {
  working: "tw-text-muted",
  waiting: "tw-text-warning",
  finished: "tw-text-muted",
  stopped: "tw-text-muted",
  failed: "tw-text-error",
};

const ICON_CLASS = "tw-mt-0.5 tw-size-3.5 tw-shrink-0";

const TONE_ICON: Record<MentionStatusTone, React.ReactNode> = {
  working: <Loader2 className={cn(ICON_CLASS, "tw-animate-spin tw-text-loading")} />,
  waiting: <CircleHelp className={ICON_CLASS} />,
  finished: <CircleCheck className={ICON_CLASS} />,
  stopped: <CircleStop className={ICON_CLASS} />,
  failed: <CircleAlert className={ICON_CLASS} />,
};

const LINK_CLASS =
  "tw-shrink-0 tw-cursor-pointer tw-text-muted tw-underline tw-underline-offset-2 hover:tw-text-normal";

function scrollToReply(from: HTMLElement, mentionId: string): void {
  from.ownerDocument
    .querySelector(`[data-agent-relay="${mentionId}"]`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export function useTickingNow(ticking: boolean, ref: React.RefObject<HTMLElement>): number {
  const [now, setNow] = useState(() => Date.now());
  // Only the element that shows a clock ticks while the agent works, so the clock never re-renders the chat's messages.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  useEffect(() => {
    const win = ref.current?.win;
    if (!ticking || !win) return;
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- a clock that starts ticking again shows the current time at once, not the time it was held at
    setNow(Date.now());
    const id = win.setInterval(() => setNow(Date.now()), 1000);
    return () => win.clearInterval(id);
  }, [ticking, ref]);
  return now;
}

export const AgentMentionStatus: React.FC<{ mention: AgentMention }> = ({ mention }) => {
  const line = mentionStatusLine(mention);
  const rootRef = useRef<HTMLDivElement>(null);
  const now = useTickingNow(line.clock === "ticking", rootRef);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const elapsedMs = line.clock ? now - mention.startedAt : line.elapsedMs;
  return (
    <div
      ref={rootRef}
      className={cn("tw-flex tw-flex-col tw-gap-1 tw-px-3 tw-text-sm", TONE_CLASS[line.tone])}
    >
      <div className="tw-flex tw-items-start tw-gap-1.5">
        {TONE_ICON[line.tone]}
        <span className="tw-min-w-0 tw-flex-1 tw-break-words">
          {line.text}
          {elapsedMs === undefined ? null : (
            <span className="tw-ml-1.5 tw-tabular-nums tw-text-faint">
              {formatRunTime(elapsedMs)}
            </span>
          )}
          {line.details ? (
            <a
              href="#"
              className={cn(LINK_CLASS, "tw-ml-1.5")}
              aria-expanded={detailsOpen}
              onClick={(event) => {
                event.preventDefault();
                setDetailsOpen((open) => !open);
              }}
            >
              Details
            </a>
          ) : null}
        </span>
        {line.seeReply ? (
          <a
            href="#"
            className={LINK_CLASS}
            onClick={(event) => {
              event.preventDefault();
              scrollToReply(event.currentTarget, mention.id);
            }}
          >
            See reply ↓
          </a>
        ) : null}
      </div>
      {detailsOpen && line.details ? (
        <pre className="tw-m-0 tw-max-h-40 tw-select-text tw-overflow-auto tw-whitespace-pre-wrap tw-break-words tw-rounded tw-bg-secondary-alt tw-p-1 tw-text-xs tw-text-muted">
          {line.details}
        </pre>
      ) : null}
    </div>
  );
};

export const AgentMentionStatusLines: React.FC<{ mentions?: readonly AgentMention[] }> = ({
  mentions,
}) => {
  const gate = useCustomAgentsGate();
  // A lapsed license still shows what each saved run says; only a license that includes custom agents can ask again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
  if ((gate !== "full" && gate !== "locked") || !mentions?.length) return null;
  return (
    <div className="tw-flex tw-flex-col tw-gap-0.5 tw-pb-1">
      {mentions.map((mention) => (
        <AgentMentionStatus key={mention.id} mention={mention} />
      ))}
    </div>
  );
};
