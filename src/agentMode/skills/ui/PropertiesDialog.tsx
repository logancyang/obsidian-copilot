import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import { DESCRIPTION_MAX, NAME_MAX, NAME_RE } from "@/agentMode/skills/skillFormat";
import type { Skill } from "@/agentMode/skills/types";

export interface PropertiesFormValues {
  name: string;
  description: string;
  allowedTools: string;
  model: string;
  disableAutoInvocation: boolean;
  hideFromSlashMenu: boolean;
}

export interface PropertiesSaveRequest {
  nameChanged: boolean;
  newName: string;
  patch: {
    description: string;
    allowedTools: string | undefined;
    model: string | undefined;
    disableModelInvocation: boolean | undefined;
    userInvocable: boolean | undefined;
  };
}

export type PropertiesSaveOutcome = "close" | "stay" | "collision";

interface PropertiesModalBodyProps {
  skill: Skill;
  skillsFolderRel: string;
  collisionError: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (req: PropertiesSaveRequest) => void;
}

const PropertiesModalBody: React.FC<PropertiesModalBodyProps> = ({
  skill,
  skillsFolderRel,
  collisionError,
  saving,
  onCancel,
  onSave,
}) => {
  const [values, setValues] = React.useState<PropertiesFormValues>(() =>
    computeInitialFormValues(skill)
  );

  const folder = skillsFolderRel.replace(/\/+$/, "");
  const nameError = validateNameField(values.name);
  const descriptionError = validateDescriptionField(values.description);

  const hasError = nameError !== null || descriptionError !== null;
  const canSave = !hasError && !saving;

  const handleSave = (): void => {
    if (!canSave) return;
    const nameChanged = values.name !== skill.name;
    const allowedToolsTrim = values.allowedTools.trim();
    const modelTrim = values.model.trim();
    onSave({
      nameChanged,
      newName: values.name,
      patch: {
        description: values.description,
        allowedTools: allowedToolsTrim.length > 0 ? allowedToolsTrim : undefined,
        model: modelTrim.length > 0 ? modelTrim : undefined,
        disableModelInvocation: values.disableAutoInvocation ? true : undefined,
        userInvocable: values.hideFromSlashMenu ? false : undefined,
      },
    });
  };

  return (
    <div className="tw-flex tw-flex-col" style={{ maxHeight: "70vh" }}>
      <div className="tw-mb-3 tw-text-[12.5px] tw-text-muted">
        Writes to{" "}
        <code className="tw-font-mono tw-text-[12px]">
          {folder}/{skill.name}/SKILL.md
        </code>
      </div>

      <div className="tw-flex-1 tw-overflow-y-auto tw-pr-1">
        <div className="tw-flex tw-flex-col tw-gap-4">
          <Field>
            <FieldLabel htmlFor="properties-name">Name</FieldLabel>
            <Input
              id="properties-name"
              type="text"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              aria-invalid={nameError !== null || collisionError}
              autoComplete="off"
              spellCheck={false}
            />
            {nameError !== null ? (
              <FieldError>{nameError}</FieldError>
            ) : collisionError ? (
              <FieldError>A skill named &ldquo;{values.name}&rdquo; already exists.</FieldError>
            ) : (
              <FieldHelp>
                Lowercase, hyphenated. This is what users type after{" "}
                <code className="tw-font-mono">/</code> in chat.
              </FieldHelp>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="properties-description">Description</FieldLabel>
            <Textarea
              id="properties-description"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              aria-invalid={descriptionError !== null}
              spellCheck={true}
              className="tw-border-border tw-text-sm"
            />
            <div className="tw-mt-0.5 tw-flex tw-items-center tw-justify-between">
              {descriptionError !== null ? <FieldError>{descriptionError}</FieldError> : <span />}
              <span
                className={cn(
                  "tw-font-mono tw-text-[11px] tw-text-faint",
                  values.description.length > DESCRIPTION_MAX && "tw-text-error"
                )}
              >
                {values.description.length} / {DESCRIPTION_MAX}
              </span>
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="properties-allowed-tools">Allowed tools</FieldLabel>
            <Input
              id="properties-allowed-tools"
              type="text"
              value={values.allowedTools}
              onChange={(e) => setValues((v) => ({ ...v, allowedTools: e.target.value }))}
              placeholder="Read Grep Bash(git:*)"
              className="tw-font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="properties-model">
              Model override <ClaudeOnlyChip />
            </FieldLabel>
            <Input
              id="properties-model"
              type="text"
              value={values.model}
              onChange={(e) => setValues((v) => ({ ...v, model: e.target.value }))}
              placeholder="claude-sonnet-4-20250514"
              className="tw-font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <label className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2.5">
            <Checkbox
              checked={values.disableAutoInvocation}
              onCheckedChange={(checked) =>
                setValues((v) => ({ ...v, disableAutoInvocation: checked === true }))
              }
              className="tw-mt-0.5"
            />
            <span className="tw-flex tw-flex-col tw-gap-0.5">
              <span className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-normal">
                Don&apos;t let Claude invoke this on its own
                <ClaudeOnlyChip />
              </span>
            </span>
          </label>

          <label className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2.5">
            <Checkbox
              checked={values.hideFromSlashMenu}
              onCheckedChange={(checked) =>
                setValues((v) => ({ ...v, hideFromSlashMenu: checked === true }))
              }
              className="tw-mt-0.5"
            />
            <span className="tw-flex tw-flex-col tw-gap-0.5">
              <span className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-normal">
                Hide from slash menu
                <ClaudeOnlyChip />
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="tw-mt-4 tw-flex tw-justify-end tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-pt-3">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="default" onClick={handleSave} disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  );
};

export class PropertiesModal extends Modal {
  private root: Root | null = null;
  private collisionError = false;
  private saving = false;

  constructor(
    app: App,
    private readonly skill: Skill,
    private readonly skillsFolderRel: string,
    private readonly onSaveCallback: (
      req: PropertiesSaveRequest
    ) => Promise<PropertiesSaveOutcome> | PropertiesSaveOutcome
  ) {
    super(app);
    // @ts-expect-error — setTitle exists on Modal but is missing from @types/obsidian.
    this.setTitle(`Properties · ${skill.name}`);
  }

  onOpen(): void {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.renderBody();
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
  }

  private renderBody(): void {
    this.root?.render(
      <PropertiesModalBody
        key={this.skill.dirPath}
        skill={this.skill}
        skillsFolderRel={this.skillsFolderRel}
        collisionError={this.collisionError}
        saving={this.saving}
        onCancel={() => this.close()}
        onSave={(req) => {
          void this.handleSave(req);
        }}
      />
    );
  }

  private async handleSave(req: PropertiesSaveRequest): Promise<void> {
    this.saving = true;
    this.collisionError = false;
    this.renderBody();
    try {
      const outcome = await this.onSaveCallback(req);
      if (outcome === "close") {
        this.close();
        return;
      }
      this.saving = false;
      this.collisionError = outcome === "collision";
      this.renderBody();
    } catch (err) {
      logError("PropertiesModal save failed", err);
      this.saving = false;
      this.renderBody();
    }
  }
}

const Field: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-flex tw-flex-col tw-gap-1">{children}</div>
);

const FieldLabel: React.FC<{ htmlFor: string; children: React.ReactNode }> = ({
  htmlFor,
  children,
}) => (
  <label
    htmlFor={htmlFor}
    className="tw-flex tw-items-center tw-gap-2 tw-text-[12.5px] tw-font-medium tw-text-normal"
  >
    {children}
  </label>
);

const FieldHelp: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-text-[11.5px] tw-text-muted">{children}</div>
);

const FieldError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-text-[11.5px] tw-text-error">{children}</div>
);

const ClaudeOnlyChip: React.FC = () => (
  <span className="tw-flex tw-items-center tw-gap-1 tw-font-mono tw-text-[9.5px] tw-uppercase tw-tracking-wide tw-text-faint">
    <span className="tw-bg-orange tw-inline-flex tw-size-3 tw-items-center tw-justify-center tw-rounded-[3px] tw-text-on-accent">
      <ClaudeMiniGlyph />
    </span>
    Claude Code only
  </span>
);

const ClaudeMiniGlyph: React.FC = () => (
  <svg viewBox="0 0 32 32" className="tw-size-[8px]" fill="currentColor" aria-hidden="true">
    <path d="M16 3 L17.5 13.2 L24.5 5.5 L19.6 14.6 L29 13 L19.6 16 L29 19 L19.6 17.4 L24.5 26.5 L17.5 18.8 L16 29 L14.5 18.8 L7.5 26.5 L12.4 17.4 L3 19 L12.4 16 L3 13 L12.4 14.6 L7.5 5.5 L14.5 13.2 Z" />
  </svg>
);

function computeInitialFormValues(skill: Skill): PropertiesFormValues {
  return {
    name: skill.name,
    description: skill.description,
    allowedTools: skill.allowedTools ?? "",
    model: skill.model ?? "",
    disableAutoInvocation: skill.disableModelInvocation === true,
    hideFromSlashMenu: skill.userInvocable === false,
  };
}

function validateNameField(name: string): string | null {
  if (name.length === 0) return "Name is required.";
  if (name.length > NAME_MAX) return `Name must be at most ${NAME_MAX} characters.`;
  if (!NAME_RE.test(name)) {
    return "Lowercase a–z, 0–9, and hyphens only — no leading, trailing, or consecutive hyphens.";
  }
  return null;
}

function validateDescriptionField(description: string): string | null {
  if (description.trim().length === 0) return "Description is required.";
  if (description.length > DESCRIPTION_MAX) {
    return `Description must be at most ${DESCRIPTION_MAX} characters.`;
  }
  return null;
}
