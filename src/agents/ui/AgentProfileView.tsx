import type { ModelSelection } from "@/agentMode";
import { agentTitle } from "@/agents/agentTitle";
import { findAgentNamed, type FaceImage } from "@/agents/customAgentFiles";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import {
  type LockedProfile,
  LockedProfileBanner,
  type SetupLockedProfile,
  SetupLockedProfileBanner,
} from "@/agents/ui/LockedAgentNotices";
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
import { SLIDE_IN_PAGE_CLASS } from "@/components/ui/slideIn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  Trash2,
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
  onDelete: () => void;
  locked?: LockedProfile;
  setupLocked?: SetupLockedProfile;
}

// A pencil follows the pointer over the head, or keyboard focus on its own control; focus a click leaves in the head
// would otherwise keep all three showing. https://github.com/Brevilabs/obsidian-copilot-private/issues/940
const SHOWN_ON_HOVER_OR_KEYBOARD_FOCUS =
  "tw-opacity-0 group-hover:tw-opacity-100 [:focus-visible>&]:tw-opacity-100";

const BLOCK_BUTTON_CLASS =
  "clickable-icon tw-h-9 tw-w-full tw-gap-1.5 tw-rounded-md tw-border tw-border-solid tw-bg-transparent tw-text-sm tw-font-medium tw-shadow-none";

const ROW_CLASS =
  "tw-flex tw-w-full tw-items-center tw-gap-2.5 tw-whitespace-normal tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2.5 tw-text-left";

export function countOf(count: number, noun: string): string {
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
  onDelete,
  locked,
  setupLocked,
}: AgentProfileViewProps): React.ReactElement {
  const { name } = agent;
  // A locked agent keeps its files open and Delete; its face, name, title and model can't change and it can't chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
  const readOnly = locked !== undefined;
  const [facePickerOpen, setFacePickerOpen] = useState(false);
  const today = now ?? Date.now();
  const length = agent.instruction.trim().length;
  const instructionTooLong = length > INSTRUCTION_SOFT_LIMIT;
  const meta = [
    facts.chatCount !== null && countOf(facts.chatCount, "chat"),
    facts.createdAt !== null && `since ${formatDayOrToday(facts.createdAt, today)}`,
  ].filter(Boolean);
  const instructionLine = instructionTooLong
    ? `Instruction · ${countOf(length, "character")} · longer than ${name} follows well`
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
      className={cn("tw-flex tw-size-full tw-flex-col tw-bg-primary", SLIDE_IN_PAGE_CLASS)}
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
      {locked ? (
        <LockedProfileBanner name={name} {...locked} />
      ) : (
        setupLocked && <SetupLockedProfileBanner {...setupLocked} />
      )}
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-3.5 tw-overflow-y-auto tw-p-3.5">
        <div className="tw-group tw-flex tw-min-w-0 tw-flex-col tw-items-center tw-gap-1.5 tw-pb-1 tw-pt-2 tw-text-center">
          {readOnly ? (
            <AgentFace src={agent.faceSrc} size="xxl" locked className="tw-mb-1.5" />
          ) : (
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
                  <AgentFace src={agent.faceSrc} size="xxl" />
                  <span
                    className={cn(
                      "tw-absolute -tw-bottom-0.5 -tw-right-0.5 tw-flex tw-size-[22px] tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-secondary tw-text-muted",
                      SHOWN_ON_HOVER_OR_KEYBOARD_FOCUS
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
          )}
          <div role="heading" aria-level={2} className="tw-flex tw-w-full tw-justify-center">
            <InlineEdit
              label={`Rename ${name}`}
              text={name}
              value={name}
              onSave={rename}
              locked={readOnly}
              textClassName="tw-text-lg tw-font-semibold tw-text-normal"
            />
          </div>
          <InlineEdit
            label={`Change ${name}'s title`}
            text={agentTitle(agent)}
            value={agent.title}
            placeholder="One line under the name"
            onSave={retitle}
            locked={readOnly}
            textClassName="tw-text-ui-small tw-text-muted"
          />
          {meta.length > 0 && (
            <div className="tw-text-ui-smaller tw-text-faint">{meta.join(" · ")}</div>
          )}
        </div>
        {!readOnly && (
          <Tooltip open={setupLocked ? undefined : false}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-disabled={setupLocked ? true : undefined}
                onClick={setupLocked ? undefined : onNewChat}
                className={cn(
                  BLOCK_BUTTON_CLASS,
                  "tw-border-border tw-text-normal",
                  setupLocked
                    ? "tw-cursor-not-allowed tw-opacity-50"
                    : "hover:tw-bg-modifier-hover",
                  NO_OBSIDIAN_TOOLTIP
                )}
              >
                <MessageSquarePlus className="tw-size-4 tw-shrink-0" />
                <span className="tw-truncate">New chat with {name}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="tw-max-w-64 tw-text-center">
              {setupLocked?.reason}
            </TooltipContent>
          </Tooltip>
        )}
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
              ? `Memory · ${name} adds to this · ${countOf(facts.memory.rules, "rule")} · ${formatChange(facts.memory.changedAt, today)}`
              : `Nothing yet. ${name} adds a rule when you correct it or ask it to remember something.`}
          </FileRow>
        </div>
        <SectionLabel>Model</SectionLabel>
        <div
          className={cn(
            ROW_CLASS,
            readOnly && "tw-opacity-60",
            !readOnly && setupLocked && "tw-border-error"
          )}
        >
          <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
            <span className="tw-text-sm tw-font-semibold tw-text-normal">Model</span>
            <span className="tw-text-ui-smaller tw-text-muted">
              {locked
                ? "Locked until you enter a valid Supporter license key"
                : "New chats and @-mentions"}
            </span>
          </span>
          <AgentModelField
            models={models}
            value={agent.model ?? models.initial}
            onChange={onChangeModel}
            container={null}
            disabled={readOnly}
            className="tw-h-7 tw-w-auto tw-min-w-0 tw-shrink tw-px-2 tw-text-ui-small"
          />
        </div>
        {/* The Model field is what keeps a setup-locked agent from chatting, so it is marked and says how to fix it.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/962 */}
        {!readOnly && setupLocked && (
          <div className="-tw-mt-2">
            <FieldError>Pick a model that runs on this device.</FieldError>
          </div>
        )}
        <div className="tw-flex-1" />
        <button
          type="button"
          onClick={onDelete}
          className={cn(
            BLOCK_BUTTON_CLASS,
            "tw-border-error tw-text-error hover:tw-bg-modifier-error-rgb/10"
          )}
        >
          <Trash2 className="tw-size-4 tw-shrink-0" />
          <span className="tw-truncate">Delete {name}…</span>
        </button>
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
  locked: boolean;
  onSave: (next: string) => Promise<string | null>;
}

// Name and title change in place: Enter or a click elsewhere saves, Esc cancels.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/940
function InlineEdit({
  label,
  text,
  value,
  placeholder,
  textClassName,
  locked,
  onSave,
}: InlineEditProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const refocus = useRef(false);
  const startedByKeyboard = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    // Focus handed back after a click-started edit must not look like keyboard focus, or its pencil stays without the
    // pointer. https://github.com/Brevilabs/obsidian-copilot-private/issues/940
    buttonRef.current?.focus({ focusVisible: startedByKeyboard.current } as FocusOptions);
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

  if (locked) return <span className={cn("tw-min-w-0 tw-break-words", textClassName)}>{text}</span>;
  if (draft === null) {
    return (
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        onClick={(event) => {
          startedByKeyboard.current = event.detail === 0;
          setDraft(value);
        }}
        className={cn(
          "clickable-icon tw-relative -tw-my-0.5 tw-mx-4 tw-h-auto tw-whitespace-normal tw-bg-transparent tw-px-1.5 tw-py-0.5 tw-shadow-none",
          NO_OBSIDIAN_TOOLTIP
        )}
      >
        <span className={cn("tw-min-w-0 [overflow-wrap:anywhere]", textClassName)}>{text}</span>
        <span
          className={cn(
            "tw-absolute tw-left-full tw-top-1/2 tw-flex -tw-translate-y-1/2 tw-pl-1 tw-text-faint",
            SHOWN_ON_HOVER_OR_KEYBOARD_FOCUS
          )}
        >
          <Pencil className="tw-size-3" />
        </span>
      </button>
    );
  }
  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-items-center tw-gap-1 tw-px-5">
      <div className="tw-relative tw-flex tw-w-full tw-max-w-60 tw-items-center">
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
        <Check
          aria-hidden="true"
          className="tw-absolute tw-left-full tw-top-1/2 tw-ml-1.5 tw-size-3.5 -tw-translate-y-1/2 tw-text-muted"
        />
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <div className="tw-text-ui-smaller tw-text-faint">Enter to save · Esc to cancel</div>
      )}
    </div>
  );
}
