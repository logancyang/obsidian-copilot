import type { CustomAgent, NewCustomAgent } from "@/agents/CustomAgentStore";
import { deriveAgentSlug, findAgentNameConflict } from "@/agents/customAgentFiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { AlertCircle, Folder } from "lucide-react";
import React, { useEffect, useId, useState } from "react";

export const INSTRUCTION_SOFT_LIMIT = 4000;
const LONG_NAME_LENGTH = 12;

export interface CreateAgentInitialValues {
  name?: string;
  title?: string;
  instruction?: string;
}

export class CreateAgentCloseGuard {
  hasInput = false;
  name = "";
}

export interface CreateAgentFormProps {
  agents: readonly Pick<CustomAgent, "slug" | "name">[];
  folderNames: readonly string[];
  agentsFolder: string;
  initialValues?: CreateAgentInitialValues;
  closeGuard: CreateAgentCloseGuard;
  onCreate: (agent: NewCustomAgent) => Promise<void>;
  onClose: () => void;
}

export function CreateAgentForm({
  agents,
  folderNames,
  agentsFolder,
  initialValues,
  closeGuard,
  onCreate,
  onClose,
}: CreateAgentFormProps): React.ReactElement {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [instruction, setInstruction] = useState(initialValues?.instruction ?? "");
  const [instructionLeftEmpty, setInstructionLeftEmpty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const ids = { name: useId(), title: useId(), instruction: useId() };

  const trimmedName = name.trim();
  const who = trimmedName || "it";
  const hasInput = [name, title, instruction].some((text) => text.trim() !== "");
  const nameTaken = trimmedName && findAgentNameConflict(agents, folderNames, trimmedName);
  const missingInstruction = instruction.trim() === "";
  const blocker = !trimmedName
    ? "Give it a name first"
    : nameTaken
      ? nameTaken
      : missingInstruction
        ? `Write what ${trimmedName} handles first`
        : null;
  const slug = trimmedName && !nameTaken && deriveAgentSlug(trimmedName);

  useEffect(() => {
    closeGuard.hasInput = hasInput;
    closeGuard.name = trimmedName;
  }, [closeGuard, hasInput, trimmedName]);

  const create = async () => {
    if (blocker) {
      setInstructionLeftEmpty(missingInstruction);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate({
        name: trimmedName,
        title: title.trim(),
        model: null,
        instruction: instruction.trim(),
      });
    } catch (error) {
      logError("[Custom agents] Creating an agent failed", error);
      const reason = error instanceof Error ? error.message : String(error);
      setCreateError(`Couldn't create ${trimmedName}. ${reason}`);
      setCreating(false);
    }
  };

  return (
    <form
      className="tw-flex tw-flex-col tw-gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="tw-flex tw-items-start tw-gap-4">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-2.5">
          <Field id={ids.name} label="Name">
            <Input
              id={ids.name}
              value={name}
              autoFocus
              placeholder="e.g. Kai"
              aria-invalid={!!nameTaken}
              className={cn(nameTaken && "!tw-border-[color:var(--text-error)]")}
              onChange={(event) => setName(event.target.value)}
            />
            {nameTaken ? (
              <FieldError>{nameTaken}</FieldError>
            ) : (
              // Names have no length limit, but tabs cut them short.
              // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
              [...trimmedName].length > LONG_NAME_LENGTH && (
                <div className="tw-text-ui-smaller tw-text-muted">
                  Long names get cut off in tabs.
                </div>
              )
            )}
          </Field>
          <Field
            id={ids.title}
            label={
              <>
                Title <span className="tw-ml-1 tw-font-normal tw-text-faint">optional</span>
              </>
            }
          >
            <Input
              id={ids.title}
              value={title}
              placeholder="One line under the name, e.g. Writes the newsletter"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>
      </div>

      <Field id={ids.instruction} label={`What ${who} handles`}>
        <Textarea
          id={ids.instruction}
          value={instruction}
          rows={5}
          aria-invalid={instructionLeftEmpty && missingInstruction}
          placeholder="e.g. You keep the books for my company. Receipts are in Finance/Receipts and the bank is Mercury. Be direct, flag anything over $500, and show me the change before you edit a ledger note."
          className={cn(
            "tw-min-h-28 tw-resize-none tw-border-border",
            instructionLeftEmpty && missingInstruction && "tw-border-[color:var(--text-error)]"
          )}
          onChange={(event) => setInstruction(event.target.value)}
          onBlur={() => setInstructionLeftEmpty(missingInstruction)}
        />
        {instructionLeftEmpty && missingInstruction ? (
          <FieldError>
            Write at least one sentence. Without it, {trimmedName || "this agent"} is just Copilot
            with a face.
          </FieldError>
        ) : (
          <div className="tw-flex tw-items-start tw-gap-3 tw-text-ui-smaller tw-text-muted">
            <span className="tw-flex-1">
              In your own words: what it handles, where things live, how it should talk.{" "}
              {trimmedName || "It"} reads this at the start of every chat.
            </span>
            {instruction && (
              // Past the soft limit the count turns orange without blocking Create.
              // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
              <span
                className={cn(
                  "tw-whitespace-nowrap tw-tabular-nums",
                  instruction.length > INSTRUCTION_SOFT_LIMIT ? "tw-text-warning" : "tw-text-faint"
                )}
              >
                {instruction.length.toLocaleString("en-US")} /{" "}
                {INSTRUCTION_SOFT_LIMIT.toLocaleString("en-US")}
              </span>
            )}
          </div>
        )}
      </Field>

      {createError && <FieldError>{createError}</FieldError>}

      <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
        <span className="tw-mr-auto tw-inline-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-ui-smaller tw-text-faint">
          <Folder className="tw-size-3 tw-shrink-0" />
          <span className="tw-truncate">
            Saved in {agentsFolder}/{slug && `${slug}/`}
          </span>
        </span>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={blocker ? 0 : -1}>
              <Button type="submit" disabled={!!blocker || creating}>
                Create
              </Button>
            </span>
          </TooltipTrigger>
          {blocker && <TooltipContent className="tw-z-tooltip">{blocker}</TooltipContent>}
        </Tooltip>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: React.ReactNode;
  children: React.ReactNode;
}

function Field({ id, label, children }: FieldProps) {
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1.5">
      <label htmlFor={id} className="tw-text-ui-small tw-font-semibold tw-text-normal">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="tw-flex tw-items-start tw-gap-1.5 tw-text-ui-smaller tw-text-error"
    >
      <AlertCircle className="tw-mt-0.5 tw-size-3.5 tw-shrink-0" />
      <span>{children}</span>
    </div>
  );
}
