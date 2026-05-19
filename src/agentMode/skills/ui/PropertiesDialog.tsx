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

/**
 * Form state captured from the user. Strings are kept as-is for inline
 * editing; we only normalize at save time. Booleans here mirror the
 * checkbox semantics (NOT the frontmatter semantics — see the field map
 * in `SKILLS_MANAGEMENT.md`).
 */
export interface PropertiesFormValues {
  name: string;
  description: string;
  allowedTools: string;
  model: string;
  /**
   * Checkbox: "Don't let Claude invoke this on its own". On the wire this
   * is `disable-model-invocation: <bool>` — same polarity (checkbox ON =
   * Claude can't auto-invoke).
   */
  disableAutoInvocation: boolean;
  /**
   * Checkbox: "Hide from slash menu". On the wire this is the inverse —
   * `user-invocable: false` means hidden. Checkbox ON = hidden = wire false.
   */
  hideFromSlashMenu: boolean;
}

/** Result the dialog hands the caller when the user clicks Save. */
export interface PropertiesSaveRequest {
  /** True when the name changed and a rename needs to run before the patch. */
  nameChanged: boolean;
  /** The new name (only meaningful when `nameChanged` is true). */
  newName: string;
  /** Patch of non-name fields (always applied via `updateProperties`). */
  patch: {
    description: string;
    allowedTools: string | undefined;
    model: string | undefined;
    disableModelInvocation: boolean | undefined;
    userInvocable: boolean | undefined;
  };
}

/**
 * Outcome the caller hands back after attempting to persist the form:
 * - `close` — save succeeded; the modal should dismiss
 * - `stay` — save failed for a reason the caller already surfaced (e.g. a Notice)
 * - `collision` — the new name clashed with an existing skill; the modal stays
 *   open and shows an inline name-collision error
 */
export type PropertiesSaveOutcome = "close" | "stay" | "collision";

interface PropertiesModalBodyProps {
  skill: Skill;
  skillsFolderRel: string;
  collisionError: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (req: PropertiesSaveRequest) => void;
}

/**
 * Form body for {@link PropertiesModal}. Mounted only when a skill is set
 * and re-mounted (via `key={skill.dirPath}`) when the target skill changes,
 * so the form always boots from the current frontmatter without an explicit
 * reset effect.
 */
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

  // The Save button is gated on inline validation. Collision errors come
  // from the save attempt itself; we don't pre-check the canonical store
  // here because that's a filesystem check the caller already runs.
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
        // Only emit when ON, to match Claude's default-false semantics —
        // an explicit `false` is also valid but redundant chrome.
        disableModelInvocation: values.disableAutoInvocation ? true : undefined,
        // The wire field defaults to `true` (visible). Emit `false` only
        // when the user actively hides the skill.
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
          {/* Name */}
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

          {/* Description */}
          <Field>
            <FieldLabel htmlFor="properties-description">Description</FieldLabel>
            <Textarea
              id="properties-description"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              aria-invalid={descriptionError !== null}
              spellCheck={true}
              className="tw-text-sm"
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

          {/* Allowed tools */}
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

          {/* Model override (Claude Code only) */}
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

          {/* Don't let Claude invoke this on its own (Claude Code only) */}
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

          {/* Hide from slash menu (Claude Code only) */}
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

/**
 * Native Obsidian per-skill properties modal. Built on Obsidian's `Modal`
 * for popout-window safety, native header chrome, and ESC handling —
 * consistent with the rest of the plugin's confirm flows (see
 * `src/components/modals/ConfirmModal.tsx` and `DeleteConfirmModal`).
 *
 * The caller's `onSave` returns a {@link PropertiesSaveOutcome}: `close`
 * dismisses the modal, `stay` keeps it open (caller already surfaced an
 * error), and `collision` keeps it open with an inline name-collision
 * error.
 */
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

/* --- Field helpers ----------------------------------------------------- */

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

/**
 * Small uppercase mono indicator with a mini Claude glyph, shown next to
 * the three Claude-only fields so the user reads them as the same concept.
 * Matches wireframe state F's `.agent-only` chip.
 */
const ClaudeOnlyChip: React.FC = () => (
  <span className="tw-flex tw-items-center tw-gap-1 tw-font-mono tw-text-[9.5px] tw-uppercase tw-tracking-wide tw-text-faint">
    <span className="tw-bg-orange tw-inline-flex tw-size-3 tw-items-center tw-justify-center tw-rounded-[3px] tw-text-on-accent">
      <ClaudeMiniGlyph />
    </span>
    Claude Code only
  </span>
);

/**
 * 9px Claude star glyph used by the "Claude Code only" indicator chip —
 * inlined here so the chip stays ~9–10px tall without scaling a full-size
 * descriptor `Icon`.
 */
const ClaudeMiniGlyph: React.FC = () => (
  <svg viewBox="0 0 32 32" className="tw-size-[8px]" fill="currentColor" aria-hidden="true">
    <path d="M16 3 L17.5 13.2 L24.5 5.5 L19.6 14.6 L29 13 L19.6 16 L29 19 L19.6 17.4 L24.5 26.5 L17.5 18.8 L16 29 L14.5 18.8 L7.5 26.5 L12.4 17.4 L3 19 L12.4 16 L3 13 L12.4 14.6 L7.5 5.5 L14.5 13.2 Z" />
  </svg>
);

/* --- Pure helpers ------------------------------------------------------ */

/**
 * Snapshot a skill's frontmatter into the form's checkbox-friendly shape.
 * Defaults missing optional fields to empty strings / unchecked boxes.
 */
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

/** Validate the `name` form field against the spec. Returns the error string or null. */
function validateNameField(name: string): string | null {
  if (name.length === 0) return "Name is required.";
  if (name.length > NAME_MAX) return `Name must be at most ${NAME_MAX} characters.`;
  if (!NAME_RE.test(name)) {
    return "Lowercase a–z, 0–9, and hyphens only — no leading, trailing, or consecutive hyphens.";
  }
  return null;
}

/** Validate the `description` form field against the spec. */
function validateDescriptionField(description: string): string | null {
  if (description.trim().length === 0) return "Description is required.";
  if (description.length > DESCRIPTION_MAX) {
    return `Description must be at most ${DESCRIPTION_MAX} characters.`;
  }
  return null;
}
