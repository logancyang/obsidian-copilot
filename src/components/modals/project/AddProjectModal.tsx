import { ProjectConfig } from "@/aiParams";
import { useApp } from "@/context";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_MODEL_SETTING } from "@/constants";
import { ProjectContextSourceEditor } from "@/components/project/ProjectContextSourceEditor";
import {
  agentsFileIsUninitialized,
  captureInstructionFiles,
  readAgentsFile,
  restoreInstructionFiles,
  writeAgentsFile,
} from "@/instructions/agentsFile";
import { logError } from "@/logger";
import { ProjectInstructionsField } from "@/instructions/ProjectInstructionsField";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById } from "@/projects/state";
import { err2String, randomUUID } from "@/utils";
import type CopilotPlugin from "@/main";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal, Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";
import { Root } from "react-dom/client";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export interface AddProjectModalContentProps {
  initialProject?: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<void>;
  onCancel: () => void;
  plugin?: CopilotPlugin;
  popoverContainer?: HTMLElement | null;
}

export function AddProjectModalContent({
  initialProject,
  onSave,
  onCancel,
  plugin,
  popoverContainer,
}: AddProjectModalContentProps) {
  const app = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    inclusions: false,
  });

  const [formData, setFormData] = useState<ProjectConfig>(() =>
    initialProject
      ? { ...initialProject }
      : {
          id: randomUUID(),
          name: "",
          description: "",
          systemPrompt: "",
          projectModelKey: "",
          modelConfigs: {
            temperature: DEFAULT_MODEL_SETTING.TEMPERATURE,
          },
          contextSource: {
            inclusions: "",
            exclusions: "",
            webUrls: "",
            youtubeUrls: "",
          },
          created: Date.now(),
          UsageTimestamps: Date.now(),
        }
  );

  const record = useMemo(
    () => (initialProject?.id ? getCachedProjectRecordById(initialProject.id) : undefined),
    [initialProject?.id]
  );
  const instructionsFolder = useMemo(
    () => (record ? getProjectAnchorFromConfigPath(record.filePath).projectFolderPath : null),
    [record]
  );
  const [instructions, setInstructions] = useState<string | null>(null);
  const [draftOwnsLegacyPrompt, setDraftOwnsLegacyPrompt] = useState(false);
  const legacyPrompt = initialProject?.systemPrompt ?? "";
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

  const handleEditProjectContext = (projectDraft: ProjectConfig) => {
    const modal = new ContextManageModal(
      app,
      (updatedProject: ProjectConfig) => {
        setFormData((prev) => ({
          ...prev,
          contextSource: {
            ...prev.contextSource,
            inclusions: updatedProject.contextSource?.inclusions,
            exclusions: updatedProject.contextSource?.exclusions,
            webUrls: updatedProject.contextSource?.webUrls,
            youtubeUrls: updatedProject.contextSource?.youtubeUrls,
          },
        }));
      },
      projectDraft
    );
    modal.open();
  };

  const isFormValid = () => Boolean(formData.name);

  const handleInputChange = (
    field: string,
    value: string | number | string[] | Record<string, unknown>
  ) => {
    setFormData((prev) => {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        value = value.map((item) => item.trim()).filter(Boolean);
      }

      if (field.includes(".")) {
        const [parent, child] = field.split(".");
        const parentKey = parent as keyof typeof prev;
        const parentValue = prev[parentKey];

        if (typeof parentValue === "object" && parentValue !== null) {
          return {
            ...prev,
            [parent]: {
              ...parentValue,
              [child]: value,
            },
          };
        }
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const handleContextChange = (patch: Partial<NonNullable<ProjectConfig["contextSource"]>>) => {
    setFormData((prev) => ({
      ...prev,
      contextSource: { ...prev.contextSource, ...patch },
    }));
  };

  const handleSave = async () => {
    const trimmedName = formData.name?.trim() ?? "";
    const saveData = initialProject
      ? {
          ...formData,
          name: trimmedName,
          projectModelKey: initialProject.projectModelKey,
          modelConfigs: initialProject.modelConfigs,
          ...(draftOwnsLegacyPrompt ? { systemPrompt: "" } : {}),
        }
      : { ...formData, name: trimmedName };

    if (!saveData.name) {
      setTouched((prev) => ({ ...prev, name: true }));
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
      setTouched((prev) => ({
        ...prev,
        name: true,
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <div className="tw-shrink-0 tw-px-4 tw-pb-2 tw-pt-4">
        <div className="tw-text-xl tw-font-bold tw-text-normal">
          {initialProject ? "Edit Project" : "New Project"}
        </div>
        <p className="tw-mt-1 tw-text-sm tw-text-muted">
          Configure your project settings and context sources
        </p>
      </div>

      <ScrollArea className="tw-min-h-0 tw-flex-1">
        <div className="tw-flex tw-flex-col tw-gap-6 tw-p-4">
          <div className="tw-rounded-lg tw-border tw-border-border tw-p-4 tw-bg-secondary/50">
            <h3 className="tw-mb-3 tw-text-sm tw-font-medium tw-text-normal">Basic Info</h3>
            <div className="tw-flex tw-flex-col tw-gap-3">
              <FormField
                label="Project Name"
                required
                error={touched.name && !formData.name}
                errorMessage="Project name is required"
              >
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                  className="tw-w-full"
                />
              </FormField>

              <FormField
                label="Description"
                description="Briefly describe the purpose and goals of the project"
              >
                <Input
                  type="text"
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  className="tw-w-full"
                />
              </FormField>

              {instructions !== null && (
                <ProjectInstructionsField value={instructions} onChange={setInstructions} />
              )}
            </div>
          </div>

          <div className="tw-rounded-lg tw-border tw-border-border tw-p-4 tw-bg-secondary/50">
            <h3 className="tw-mb-3 tw-text-sm tw-font-medium tw-text-normal">Context Sources</h3>
            <ProjectContextSourceEditor
              contextSource={formData.contextSource}
              onChange={handleContextChange}
              onManage={() => handleEditProjectContext(formData)}
              popoverContainer={popoverContainer}
              droppable={false}
              solidManageButton
              showHelperText
            />
          </div>
        </div>
      </ScrollArea>

      <div className="tw-shrink-0 tw-border-t tw-border-border tw-px-4 tw-py-3">
        <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={safeAsyncHandler(handleSave)} disabled={isSubmitting || !isFormValid()}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export class AddProjectModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onSave: (project: ProjectConfig) => Promise<void>,
    private initialProject?: ProjectConfig,
    private plugin?: CopilotPlugin
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    modalEl.addClass("!tw-max-h-[85vh]", "tw-min-w-[50vw]");

    this.root = createPluginRoot(contentEl, this.app);

    const handleSave = async (project: ProjectConfig) => {
      await this.onSave(project);
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <AddProjectModalContent
        initialProject={this.initialProject}
        onSave={handleSave}
        onCancel={handleCancel}
        plugin={this.plugin}
        popoverContainer={contentEl}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
