import { agentTitle } from "@/agents/agentTitle";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import { INSTRUCTION_SOFT_LIMIT } from "@/agents/ui/CreateAgentForm";
import { cn } from "@/lib/utils";
import { ArrowLeft, Brain, ChevronRight, FileText, MessageSquarePlus } from "lucide-react";
import React from "react";

export interface AgentMemoryFacts {
  rules: number;
  changedAt: number;
}

export interface AgentProfileFacts {
  chatCount: number | null;
  createdAt: number | null;
  editedAt: number | null;
  memory: AgentMemoryFacts | null;
}

export type ProfileAgent = Pick<
  CustomAgent,
  "slug" | "name" | "title" | "instruction" | "faceSrc" | "instructionsPath" | "memoryPath"
>;

export interface AgentProfileViewProps {
  agent: ProfileAgent;
  facts: AgentProfileFacts;
  now?: number;
  onBack: () => void;
  onNewChat: () => void;
  onOpenFile: (path: string) => void;
}

const BLOCK_BUTTON_CLASS =
  "clickable-icon tw-h-9 tw-w-full tw-gap-1.5 tw-rounded-md tw-border tw-border-solid tw-bg-transparent tw-text-sm tw-font-medium tw-shadow-none";

const ROW_CLASS =
  "tw-flex tw-w-full tw-items-center tw-gap-2.5 tw-whitespace-normal tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2.5 tw-text-left";

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function formatDay(at: number, now: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function formatDayOrToday(at: number, now: number): string {
  return sameDay(new Date(at), new Date(now)) ? "today" : formatDay(at, now);
}

function formatWritten(createdAt: number | null, editedAt: number, now: number): string {
  const verb =
    createdAt !== null && sameDay(new Date(createdAt), new Date(editedAt)) ? "written" : "edited";
  return `${verb} ${formatDayOrToday(editedAt, now)}`;
}

function formatChange(at: number, now: number): string {
  if (!sameDay(new Date(at), new Date(now))) return formatDay(at, now);
  const time = new Date(at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `today ${time}`;
}

export function AgentProfileView({
  agent,
  facts,
  now,
  onBack,
  onNewChat,
  onOpenFile,
}: AgentProfileViewProps): React.ReactElement {
  const { name } = agent;
  const today = now ?? Date.now();
  const length = agent.instruction.trim().length;
  const instructionTooLong = length > INSTRUCTION_SOFT_LIMIT;
  const meta = [
    facts.chatCount !== null && plural(facts.chatCount, "chat"),
    facts.createdAt !== null && `since ${formatDayOrToday(facts.createdAt, today)}`,
  ].filter(Boolean);
  const instructionLine = instructionTooLong
    ? `Instruction · ${plural(length, "character")} · longer than ${name} follows well`
    : [
        "Instruction · you write this",
        facts.editedAt !== null && formatWritten(facts.createdAt, facts.editedAt, today),
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div
      className="tw-flex tw-size-full tw-flex-col tw-bg-primary"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Obsidian's own Esc handling would otherwise take the focus Back hands to the chat input.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
        event.preventDefault();
        onBack();
      }}
    >
      <div className="tw-flex tw-shrink-0 tw-items-center tw-border-0 tw-border-b tw-border-solid tw-border-border tw-px-2.5 tw-py-1.5">
        <button
          type="button"
          autoFocus
          onClick={onBack}
          className="clickable-icon tw-h-auto tw-gap-1 tw-bg-transparent tw-px-1.5 tw-py-0.5 tw-text-ui-small tw-text-normal tw-shadow-none"
        >
          <ArrowLeft className="tw-size-3.5" />
          Back to chat
        </button>
      </div>
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-3.5 tw-overflow-y-auto tw-p-3.5">
        <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-center tw-gap-1.5 tw-pb-1 tw-pt-2 tw-text-center">
          <AgentFace src={agent.faceSrc} size="xxl" selected />
          <div
            role="heading"
            aria-level={2}
            className="tw-mt-1.5 tw-max-w-full tw-break-words tw-text-lg tw-font-semibold tw-text-normal"
          >
            {name}
          </div>
          <div className="tw-max-w-full tw-break-words tw-text-ui-small tw-text-muted">
            {agentTitle(agent)}
          </div>
          {meta.length > 0 && (
            <div className="tw-text-ui-smaller tw-text-faint">{meta.join(" · ")}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className={cn(
            BLOCK_BUTTON_CLASS,
            "tw-border-border tw-text-normal hover:tw-bg-modifier-hover"
          )}
        >
          <MessageSquarePlus className="tw-size-4 tw-shrink-0" />
          <span className="tw-truncate">New chat with {name}</span>
        </button>
        <SectionLabel>What {name} knows</SectionLabel>
        <div className="tw-flex tw-flex-col tw-gap-2">
          <FileRow
            icon={FileText}
            title={`What ${name} handles`}
            onOpen={() => onOpenFile(agent.instructionsPath)}
          >
            {/* Past the soft limit the row says the instruction is too long to follow well, without blocking anything.
                https://github.com/Brevilabs/obsidian-copilot-private/issues/940 */}
            <span className={cn(instructionTooLong && "tw-text-warning")}>{instructionLine}</span>
          </FileRow>
          {/* MEMORY.md is only written on the first save, so a new agent's row says what it will hold and has nothing to open.
              https://github.com/Brevilabs/obsidian-copilot-private/issues/940 */}
          <FileRow
            icon={Brain}
            title={`Rules ${name} remembers`}
            onOpen={facts.memory ? () => onOpenFile(agent.memoryPath) : undefined}
          >
            {facts.memory
              ? `Memory · ${name} adds to this · ${plural(facts.memory.rules, "rule")} · ${formatChange(facts.memory.changedAt, today)}`
              : `Nothing yet. ${name} adds a rule when you correct it or ask it to remember something.`}
          </FileRow>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="heading"
      aria-level={3}
      className="-tw-mb-1 tw-mt-1.5 tw-text-ui-smaller tw-uppercase tw-tracking-wide tw-text-faint"
    >
      {children}
    </div>
  );
}

interface FileRowProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onOpen?: () => void;
  children: React.ReactNode;
}

function FileRow({ icon: Icon, title, onOpen, children }: FileRowProps) {
  const body = (
    <>
      <Icon className="tw-size-4 tw-shrink-0 tw-text-muted" />
      <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
        <span className="tw-text-sm tw-font-semibold tw-text-normal">{title}</span>
        <span className="tw-text-ui-smaller tw-text-muted">{children}</span>
      </span>
    </>
  );
  if (!onOpen) return <div className={ROW_CLASS}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        ROW_CLASS,
        "clickable-icon tw-h-auto tw-shadow-none hover:tw-bg-modifier-hover"
      )}
    >
      {body}
      <span className="tw-shrink-0 tw-text-ui-smaller tw-text-muted">Open</span>
      <ChevronRight className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
    </button>
  );
}
