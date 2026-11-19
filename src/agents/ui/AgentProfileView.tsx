import type { ModelSelection } from "@/agentMode";
import { agentTitle } from "@/agents/agentTitle";
import { findAgentNamed, type FaceImage } from "@/agents/customAgentFiles";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import { NO_OBSIDIAN_TOOLTIP } from "@/connectors/ui/ConnectorRow";
import type { PickedFace } from "@/agents/ui/AgentFacePicker";
import {
  AgentModelField,
  FieldError,
  INSTRUCTION_SOFT_LIMIT,
  type AgentModelChoices,
} from "@/agents/ui/CreateAgentForm";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronRight,
  FileText,
  MessageSquarePlus,
  Pencil,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

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
  | "slug"
  | "name"
  | "title"
  | "instruction"
  | "model"
  | "faceSrc"
  | "instructionsPath"
  | "memoryPath"
>;

export interface AgentProfileViewProps {
  agent: ProfileAgent;
  facts: AgentProfileFacts;
  now?: number;
  onBack: () => void;
  onNewChat: () => void;
  onOpenFile: (path: string) => void;
  otherAgents: readonly Pick<CustomAgent, "slug" | "name">[];
  models: AgentModelChoices;
  renderFacePicker: (onPick: (face: PickedFace) => void) => React.ReactNode;
  onRename: (name: string) => Promise<void>;
  onRetitle: (title: string) => Promise<void>;
  onChangeFace: (face: FaceImage) => void;
  onChangeModel: (model: ModelSelection) => void;
}

const SHOWN_ON_HOVER_OR_FOCUS =
  "tw-opacity-0 group-focus-within:tw-opacity-100 group-hover:tw-opacity-100";

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
  otherAgents,
  models,
  renderFacePicker,
  onRename,
  onRetitle,
  onChangeFace,
  onChangeModel,
}: AgentProfileViewProps): React.ReactElement {
  const { name } = agent;
  const [facePickerOpen, setFacePickerOpen] = useState(false);
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

  const save = async (write: () => Promise<void>): Promise<string | null> => {
    try {
      await write();
      return null;
    } catch (error) {
      // A hand-broken instructions.md refuses property writes; the raw YAML error means nothing to the user.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
      logError("[Custom agents] Saving the profile failed", error);
      return `Couldn't save. Fix the properties at the top of ${name}'s instructions.md first.`;
    }
  };
  const rename = async (next: string): Promise<string | null> => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return null;
    const others = otherAgents.filter((other) => other.slug !== agent.slug);
    const taken = findAgentNamed(others, trimmed);
    if (taken) return `${taken.name} is already on your team. Pick another name.`;
    return save(() => onRename(trimmed));
  };
  const retitle = async (next: string): Promise<string | null> => {
    const trimmed = next.trim();
    return trimmed === agent.title ? null : save(() => onRetitle(trimmed));
  };

  return (
    <div
      className="tw-flex tw-size-full tw-flex-col tw-bg-primary"
      onKeyDown={(event) => {
        // An open picker or a name being edited takes Esc first; only an Esc nothing used leaves the profile.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
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
        <div className="tw-group tw-flex tw-min-w-0 tw-flex-col tw-items-center tw-gap-1.5 tw-pb-1 tw-pt-2 tw-text-center">
          <Popover open={facePickerOpen} onOpenChange={setFacePickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Change ${name}'s face`}
                className={cn(
                  "clickable-icon tw-relative tw-mb-1.5 tw-h-auto tw-rounded-full tw-bg-transparent tw-p-0 tw-shadow-none",
                  NO_OBSIDIAN_TOOLTIP
                )}
              >
                <AgentFace src={agent.faceSrc} size="xxl" selected />
                <span
                  className={cn(
                    "tw-absolute -tw-bottom-0.5 -tw-right-0.5 tw-flex tw-size-[22px] tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-secondary tw-text-muted",
                    SHOWN_ON_HOVER_OR_FOCUS
                  )}
                >
                  <Pencil className="tw-size-3" />
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="tw-w-auto tw-p-2.5">
              {renderFacePicker((picked) => {
                setFacePickerOpen(false);
                onChangeFace(picked.image);
              })}
            </PopoverContent>
          </Popover>
          <div role="heading" aria-level={2} className="tw-flex tw-w-full tw-justify-center">
            <InlineEdit
              label={`Rename ${name}`}
              text={name}
              value={name}
              onSave={rename}
              textClassName="tw-text-lg tw-font-semibold tw-text-normal"
            />
          </div>
          <InlineEdit
            label={`Change ${name}'s title`}
            text={agentTitle(agent)}
            value={agent.title}
            placeholder="One line under the name"
            onSave={retitle}
            textClassName="tw-text-ui-small tw-text-muted"
          />
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
        <SectionLabel>Model</SectionLabel>
        <div className={ROW_CLASS}>
          <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
            <span className="tw-text-sm tw-font-semibold tw-text-normal">Model</span>
            <span className="tw-text-ui-smaller tw-text-muted">New chats and @-mentions</span>
          </span>
          <AgentModelField
            models={models}
            value={agent.model ?? models.initial}
            onChange={onChangeModel}
            container={null}
            className="tw-h-7 tw-w-auto tw-min-w-0 tw-shrink tw-px-2 tw-text-ui-small"
          />
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

interface InlineEditProps {
  label: string;
  text: string;
  value: string;
  placeholder?: string;
  textClassName: string;
  onSave: (next: string) => Promise<string | null>;
}

// Name and title change in place: Enter or a click elsewhere saves, Esc cancels.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/940
function InlineEdit({ label, text, value, placeholder, textClassName, onSave }: InlineEditProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const refocus = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [draft]);

  const commit = async (fromKeyboard: boolean) => {
    if (draft === null || saving.current) return;
    saving.current = true;
    const failure = await onSave(draft);
    saving.current = false;
    setError(failure);
    if (failure) return;
    refocus.current = fromKeyboard;
    setDraft(null);
  };

  if (draft === null) {
    return (
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        onClick={() => setDraft(value)}
        className={cn(
          "clickable-icon tw-h-auto tw-max-w-full tw-gap-1 tw-whitespace-normal tw-bg-transparent tw-p-0 tw-shadow-none",
          NO_OBSIDIAN_TOOLTIP
        )}
      >
        <span className={cn("tw-min-w-0 tw-break-words", textClassName)}>{text}</span>
        <span className={cn("tw-flex tw-shrink-0 tw-text-faint", SHOWN_ON_HOVER_OR_FOCUS)}>
          <Pencil className="tw-size-3" />
        </span>
      </button>
    );
  }
  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-items-center tw-gap-1">
      <div className="tw-flex tw-w-full tw-max-w-60 tw-items-center tw-gap-1.5">
        <Input
          autoFocus
          aria-label={label}
          aria-invalid={!!error}
          value={draft}
          placeholder={placeholder}
          className={cn(
            "tw-min-w-0 tw-flex-1 tw-border-interactive-accent tw-text-center",
            textClassName
          )}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              refocus.current = true;
              setError(null);
              setDraft(null);
            }
          }}
        />
        <Check aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <div className="tw-text-ui-smaller tw-text-faint">Enter to save · Esc to cancel</div>
      )}
    </div>
  );
}
