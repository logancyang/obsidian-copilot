import type { ModelSelection } from "@/agentMode";
import type { CustomAgent, NewCustomAgent } from "@/agents/CustomAgentStore";
import {
  deriveAgentSlug,
  findAgentNameConflict,
  NEUTRAL_FACE_SRC,
} from "@/agents/customAgentFiles";
import { AgentFace } from "@/agents/ui/AgentFace";
import { AgentFacePicker, type PickedFace } from "@/agents/ui/AgentFacePicker";
import type { PresetFacesState } from "@/agents/ui/usePresetFaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getModelKeyFromModel } from "@/lib/model-key";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { AlertCircle, Folder, Lightbulb, Pencil } from "lucide-react";
import React, { useEffect, useId, useState } from "react";

export const INSTRUCTION_SOFT_LIMIT = 4000;
const LONG_NAME_LENGTH = 12;

export interface EffortChoice {
  label: string;
  value: string | null;
}

export interface AgentModelChoices {
  models: ModelSelectorEntry[];
  effortOptionsByModelKey: Record<string, EffortChoice[]>;
  initial: ModelSelection | null;
}

export interface CreateAgentInitialValues {
  name?: string;
  title?: string;
  instruction?: string;
}

export interface DraftedBy {
  name: string;
  faceSrc: string;
}

export class CreateAgentCloseGuard {
  hasInput = false;
  name = "";
}

export interface CreateAgentFormProps {
  agents: readonly Pick<CustomAgent, "slug" | "name">[];
  folderNames: readonly string[];
  agentsFolder: string;
  models: AgentModelChoices;
  presetFaces: PresetFacesState;
  initialValues?: CreateAgentInitialValues;
  draftedBy?: DraftedBy;
  closeGuard: CreateAgentCloseGuard;
  onCreate: (agent: NewCustomAgent) => Promise<void>;
  onClose: () => void;
  onAskCopilot?: (message: string) => void;
}

interface DialogNoteProps {
  icon: React.ReactNode;
  children: React.ReactNode;
}

function DialogNote({ icon, children }: DialogNoteProps): React.ReactElement {
  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-modifier-hover tw-px-2.5 tw-py-2 tw-text-ui-small tw-text-muted">
      {icon}
      {children}
    </div>
  );
}

export function CreateAgentForm({
  agents,
  folderNames,
  agentsFolder,
  models,
  presetFaces,
  initialValues,
  draftedBy,
  closeGuard,
  onCreate,
  onClose,
  onAskCopilot,
}: CreateAgentFormProps): React.ReactElement {
  const [rootEl, setRootEl] = useState<HTMLFormElement | null>(null);
  const [start] = useState(() => [
    initialValues?.name ?? "",
    initialValues?.title ?? "",
    initialValues?.instruction ?? "",
  ]);
  const [name, setName] = useState(start[0]);
  const [leftName, setLeftName] = useState(start[0]);
  const [title, setTitle] = useState(start[1]);
  const [instruction, setInstruction] = useState(start[2]);
  const [model, setModel] = useState(models.initial);
  const [pickedFace, setFace] = useState<PickedFace | null>(null);
  const [facePickerOpen, setFacePickerOpen] = useState(false);
  const [instructionLeftEmpty, setInstructionLeftEmpty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const ids = { name: useId(), title: useId(), instruction: useId() };

  const face = pickedFace ?? unusedPresetFace(presetFaces);
  const trimmedName = name.trim();
  // The name shows elsewhere in the dialog only once its field is left, so typing changes just the field.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  const shownName = leftName.trim();
  const who = shownName || "it";
  // Closing a prefilled dialog the user has not touched loses nothing, so only their own edits are guarded.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/963
  const hasInput = [name, title, instruction].some(
    (text, index) => text.trim() !== start[index].trim()
  );
  const nameTaken = trimmedName && findAgentNameConflict(agents, folderNames, trimmedName);
  const missingInstruction = instruction.trim() === "";
  const blocker = !trimmedName
    ? "Give it a name first"
    : nameTaken
      ? nameTaken
      : missingInstruction
        ? `Write what ${trimmedName} handles first`
        : null;
  const shownSlug =
    shownName &&
    !findAgentNameConflict(agents, folderNames, shownName) &&
    deriveAgentSlug(shownName);

  useEffect(() => {
    closeGuard.hasInput = hasInput;
    closeGuard.name = trimmedName;
  }, [closeGuard, hasInput, trimmedName]);

  // Only what the user typed goes to Copilot; a prefilled template is the dialog's, not theirs. The message is one sentence ending where the user describes the agent, so a missing name is Copilot's to suggest.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  const typed = (text: string, index: number) =>
    text.trim() === start[index].trim() ? "" : text.trim();
  const askCopilot = () => {
    const typedName = typed(name, 0);
    const naming = typedName ? `named ${typedName} for me` : "for me and suggest a name for it";
    onAskCopilot?.(
      `Create a new teammate ${naming}. Here's what it should do: ${typed(instruction, 2)}`
    );
  };

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
        model,
        instruction: instruction.trim(),
        face: face?.image,
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
      ref={setRootEl}
      className="tw-flex tw-flex-col tw-gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      {draftedBy && (
        <DialogNote icon={<AgentFace src={draftedBy.faceSrc} size="s" />}>
          <span>
            <span className="tw-font-semibold tw-text-normal">Drafted by {draftedBy.name}.</span>{" "}
            Check it, pick a face and a model, then create.
          </span>
        </DialogNote>
      )}
      {onAskCopilot && (
        <DialogNote icon={<Lightbulb className="tw-size-4 tw-shrink-0" />}>
          <span className="tw-flex-1">
            <span className="tw-font-semibold tw-text-normal">Tip:</span> you can also just ask.
            Tell Copilot what you need and it drafts the teammate for you.
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={askCopilot}>
            Ask Copilot
          </Button>
        </DialogNote>
      )}
      <div className="tw-flex tw-items-start tw-gap-4">
        <Popover open={facePickerOpen} onOpenChange={setFacePickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Change face"
              className="clickable-icon tw-relative tw-h-auto tw-shrink-0 tw-rounded-full tw-bg-transparent tw-p-0 tw-shadow-none"
            >
              <AgentFace src={face?.src ?? NEUTRAL_FACE_SRC} size="xl" />
              <span className="tw-absolute -tw-bottom-0.5 -tw-right-0.5 tw-flex tw-size-[22px] tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-secondary tw-text-muted">
                <Pencil className="tw-size-3" />
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent container={rootEl} align="start" className="tw-w-auto tw-p-2.5">
            <AgentFacePicker
              presets={presetFaces}
              selectedPresetId={face?.presetId}
              onPick={(picked) => {
                setFace(picked);
                setFacePickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-2.5">
          <Field id={ids.name} label="Name">
            <Input
              id={ids.name}
              value={name}
              autoFocus
              placeholder="e.g. Leo"
              aria-invalid={!!nameTaken}
              className={cn(nameTaken && "!tw-border-[color:var(--text-error)]")}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setLeftName(name)}
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
            Write at least one sentence. Without it, {shownName || "this teammate"} is just Copilot
            with a face.
          </FieldError>
        ) : (
          <div className="tw-flex tw-items-start tw-gap-3 tw-text-ui-smaller tw-text-muted">
            <span className="tw-flex-1">
              In your own words: what it handles, where things live, how it should talk.{" "}
              {shownName || "It"} reads this at the start of every chat.
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

      <div className="tw-flex tw-flex-col tw-gap-1.5">
        <div className="tw-text-ui-small tw-font-semibold tw-text-normal">Model</div>
        <AgentModelField models={models} value={model} onChange={setModel} container={rootEl} />
      </div>

      {createError && <FieldError>{createError}</FieldError>}

      <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
        <span className="tw-mr-auto tw-inline-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-ui-smaller tw-text-faint">
          <Folder className="tw-size-3 tw-shrink-0" />
          <span className="tw-truncate">
            Saved in {agentsFolder}/{shownSlug && `${shownSlug}/`}
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

// The dialog opens with a face no other agent wears, so it is never faceless and never a twin.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/939
function unusedPresetFace(presets: PresetFacesState): PickedFace | null {
  if (presets.status !== "ready") return null;
  const preset = presets.faces.find((face) => !presets.usedIds.has(face.id)) ?? presets.faces[0];
  return preset
    ? { image: { kind: "preset", bytes: preset.bytes }, src: preset.src, presetId: preset.id }
    : null;
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

export function FieldError({ children }: { children: React.ReactNode }) {
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

interface AgentModelFieldProps {
  models: AgentModelChoices;
  value: ModelSelection | null;
  onChange: (model: ModelSelection) => void;
  container: HTMLElement | null;
  disabled?: boolean;
  className?: string;
}

export function AgentModelField({
  models,
  value,
  onChange,
  container,
  disabled,
  className,
}: AgentModelFieldProps) {
  const entry = value && models.models.find((candidate) => candidate.name === value.baseModelId);
  const key = entry ? getModelKeyFromModel(entry) : "";
  const effortOptions = models.effortOptionsByModelKey[key] ?? [];
  return (
    <ModelEffortPicker
      container={container}
      className={cn(
        "tw-h-9 tw-w-full tw-justify-between tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-3 tw-text-sm tw-text-normal",
        className
      )}
      override={{
        models: models.models,
        value: key,
        disabled,
        effortOptionsByModelKey: models.effortOptionsByModelKey,
        effort:
          value && effortOptions.length > 0
            ? {
                options: effortOptions,
                value: value.effort,
                onChange: (effort) => onChange({ ...value, effort }),
              }
            : undefined,
        commitSelection: (modelKey, effort) => {
          const picked = models.models.find((m) => getModelKeyFromModel(m) === modelKey);
          if (picked) onChange({ baseModelId: picked.name, effort });
        },
      }}
    />
  );
}
