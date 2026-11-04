import { ProjectConfig } from "@/aiParams";
import { useApp } from "@/context";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ProjectInstructionsField } from "@/instructions/ProjectInstructionsField";
import {
  agentsFileIsUninitialized,
  captureInstructionFiles,
  readAgentsFile,
  restoreInstructionFiles,
  writeAgentsFile,
} from "@/instructions/agentsFile";
import { logError } from "@/logger";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById } from "@/projects/state";
import { err2String } from "@/utils";
import { App, Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export interface EditProjectFormProps {
  name: string;
  description: string;
  instructions: string | null;
  showNameError: boolean;
  isSubmitting: boolean;
  onNameChange: (name: string) => void;
  onNameBlur: () => void;
  onDescriptionChange: (description: string) => void;
  onInstructionsChange: (instructions: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function EditProjectForm({
  name,
  description,
  instructions,
  showNameError,
  isSubmitting,
  onNameChange,
  onNameBlur,
  onDescriptionChange,
  onInstructionsChange,
  onSave,
  onCancel,
}: EditProjectFormProps): React.ReactElement {
  return (
    <form
      className="tw-flex tw-flex-col tw-gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <FormField
        label="Project name"
        required
        error={showNameError}
        errorMessage="Project name is required"
      >
        <Input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onNameBlur}
          className="tw-w-full"
        />
      </FormField>

      <FormField
        label="Description"
        description="Briefly describe the purpose and goals of the project"
      >
        <Input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="tw-w-full"
        />
      </FormField>

      {instructions !== null && (
        <ProjectInstructionsField value={instructions} onChange={onInstructionsChange} />
      )}

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !name}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}

export interface EditProjectModalContentProps {
  initialProject: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<void>;
  onCancel: () => void;
}

export function EditProjectModalContent({
  initialProject,
  onSave,
  onCancel,
}: EditProjectModalContentProps) {
  const app = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState({ name: false });

  const [formData, setFormData] = useState<ProjectConfig>(() => ({ ...initialProject }));

  const record = useMemo(() => getCachedProjectRecordById(initialProject.id), [initialProject.id]);
  const instructionsFolder = useMemo(
    () => (record ? getProjectAnchorFromConfigPath(record.filePath).projectFolderPath : null),
    [record]
  );
  const [instructions, setInstructions] = useState<string | null>(null);
  const [draftOwnsLegacyPrompt, setDraftOwnsLegacyPrompt] = useState(false);
  const legacyPrompt = initialProject.systemPrompt ?? "";
  useEffect(() => {
    if (instructionsFolder === null) return;
    let cancelled = false;
    void Promise.all([
      readAgentsFile(app, instructionsFolder),
      agentsFileIsUninitialized(app, instructionsFolder),
    ])
      .then(([content, uninitialized]) => {
        if (cancelled) return;
        const seedFromLegacy = uninitialized && legacyPrompt.trim().length > 0;
        setInstructions(seedFromLegacy ? legacyPrompt : content);
        setDraftOwnsLegacyPrompt(seedFromLegacy);
      })
      .catch((error) => {
        logError("Failed to read project instructions.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [app, instructionsFolder, legacyPrompt]);

  const handleSave = async () => {
    const trimmedName = formData.name?.trim() ?? "";
    const saveData = {
      ...formData,
      name: trimmedName,
      ...(draftOwnsLegacyPrompt ? { systemPrompt: "" } : {}),
    };

    if (!saveData.name) {
      setTouched({ name: true });
      new Notice("Please fill in all required fields");
      return;
    }

    const instructionEdit =
      instructionsFolder !== null && instructions !== null
        ? { folder: instructionsFolder, text: instructions }
        : null;

    try {
      setIsSubmitting(true);
      const before = instructionEdit
        ? await captureInstructionFiles(app, instructionEdit.folder)
        : null;
      if (instructionEdit) {
        await writeAgentsFile(app, instructionEdit.folder, instructionEdit.text);
      }
      try {
        await onSave(saveData);
      } catch (e) {
        if (instructionEdit && before) {
          await restoreInstructionFiles(app, instructionEdit.folder, before);
        }
        throw e;
      }
    } catch (e) {
      new Notice(err2String(e));
      setTouched({ name: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <EditProjectForm
      name={formData.name}
      description={formData.description ?? ""}
      instructions={instructions}
      showNameError={touched.name && !formData.name}
      isSubmitting={isSubmitting}
      onNameChange={(name) => setFormData((prev) => ({ ...prev, name }))}
      onNameBlur={() => setTouched({ name: true })}
      onDescriptionChange={(description) => setFormData((prev) => ({ ...prev, description }))}
      onInstructionsChange={setInstructions}
      onSave={safeAsyncHandler(handleSave)}
      onCancel={onCancel}
    />
  );
}

export class EditProjectModal extends ReactModal {
  constructor(
    app: App,
    private readonly onSave: (project: ProjectConfig) => Promise<void>,
    private readonly initialProject: ProjectConfig
  ) {
    super(app, "Edit project");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <EditProjectModalContent
        initialProject={this.initialProject}
        onSave={async (project) => {
          await this.onSave(project);
          close();
        }}
        onCancel={close}
      />
    );
  }
}
