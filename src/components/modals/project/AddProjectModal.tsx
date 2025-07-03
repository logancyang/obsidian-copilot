import { ProjectConfig } from "@/aiParams";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { getModelDisplayWithIcons } from "@/components/ui/model-display";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { SettingSlider } from "@/components/ui/setting-slider";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULT_MODEL_SETTING } from "@/constants";
import { getDecodedPatterns } from "@/search/searchUtils";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { checkModelApiKey, err2String, randomUUID } from "@/utils";
import { HelpCircle } from "lucide-react";
import { App, Modal, Notice } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface AddProjectModalContentProps {
  initialProject?: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<void>;
  onCancel: () => void;
}

function AddProjectModalContent({ initialProject, onSave, onCancel }: AddProjectModalContentProps) {
  const settings = useSettingsValue();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    systemPrompt: false,
    projectModelKey: false,
    inclusions: false,
  });

  const [formData, setFormData] = useState<ProjectConfig>(
    initialProject || {
      id: randomUUID(),
      name: "",
      description: "",
      systemPrompt: "",
      projectModelKey: "",
      modelConfigs: {
        temperature: DEFAULT_MODEL_SETTING.TEMPERATURE,
        maxTokens: DEFAULT_MODEL_SETTING.MAX_TOKENS,
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

  const showContext = getDecodedPatterns(
    formData.contextSource.inclusions || formData.contextSource.exclusions || "nothing"
  )
    .reverse()
    .join(",");

  const handleEditProjectContext = (originP: ProjectConfig) => {
    const modal = new ContextManageModal(
      app,
      async (updatedProject: ProjectConfig) => {
        setFormData(updatedProject);
      },
      originP
    );
    modal.open();
  };

  const isFormValid = () => {
    return formData.name && formData.projectModelKey;
  };

  const handleInputChange = (
    field: string,
    value: string | number | string[] | Record<string, any>
  ) => {
    setFormData((prev) => {
      // Handle text input
      if (typeof value === "string") {
        // Only trim for model key which shouldn't have whitespace
        if (field === "projectModelKey") {
          value = value.trim();
        }
      }
      // Handle string arrays
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

  const handleSave = async () => {
    // Trim the project name before validation and saving
    if (formData.name) {
      formData.name = formData.name.trim();
    }

    const requiredFields = ["name", "projectModelKey"];
    const missingFields = requiredFields.filter((field) => !formData[field as keyof ProjectConfig]);

    if (missingFields.length > 0) {
      setTouched((prev) => ({
        ...prev,
        ...Object.fromEntries(missingFields.map((field) => [field, true])),
      }));
      new Notice("Please fill in all required fields");
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave(formData as ProjectConfig);
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
    <div className="tw-flex tw-flex-col tw-gap-2 tw-p-4">
      <div className="tw-mb-2 tw-text-xl tw-font-bold tw-text-normal">
        {initialProject ? "Edit Project" : "New Project"}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
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

        <FormField
          label="Project System Prompt"
          description="Custom instructions for how the AI should behave in this project context"
        >
          <Textarea
            value={formData.systemPrompt}
            onChange={(e) => handleInputChange("systemPrompt", e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, systemPrompt: true }))}
            className="tw-min-h-32"
          />
        </FormField>

        <FormField
          label="Default Model"
          required
          error={touched.projectModelKey && !formData.projectModelKey}
          errorMessage="Default model is required"
        >
          <ObsidianNativeSelect
            value={formData.projectModelKey}
            onChange={(e) => {
              const value = e.target.value;
              const selectedModel = settings.activeModels.find(
                (m) => m.enabled && getModelKeyFromModel(m) === value
              );
              if (!selectedModel) return;

              const { hasApiKey, errorNotice } = checkModelApiKey(selectedModel, settings);
              if (!hasApiKey && errorNotice) {
                new Notice(errorNotice);
                return;
              }
              handleInputChange("projectModelKey", value);
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, projectModelKey: true }))}
            placeholder="Select a model"
            options={settings.activeModels
              .filter((m) => m.enabled && m.projectEnabled)
              .map((model) => ({
                label: getModelDisplayWithIcons(model),
                value: getModelKeyFromModel(model),
              }))}
          />
        </FormField>

        <div className="tw-space-y-4">
          <div className="tw-text-base tw-font-medium">Model Configuration</div>
          <div className="tw-grid tw-grid-cols-1 tw-gap-4">
            <FormField label="Temperature">
              <SettingSlider
                value={formData.modelConfigs?.temperature ?? DEFAULT_MODEL_SETTING.TEMPERATURE}
                onChange={(value) => handleInputChange("modelConfigs.temperature", value)}
                min={0}
                max={2}
                step={0.01}
                className="tw-w-full"
              />
            </FormField>
            <FormField label="Token Limit">
              <SettingSlider
                value={formData.modelConfigs?.maxTokens ?? DEFAULT_MODEL_SETTING.MAX_TOKENS}
                onChange={(value) => handleInputChange("modelConfigs.maxTokens", value)}
                min={1}
                max={65000}
                step={1}
                className="tw-w-full"
              />
            </FormField>
          </div>
        </div>

        <div className="tw-space-y-4">
          <div className="tw-text-base tw-font-medium">Context Sources</div>
          <FormField
            label={
              <div className="tw-flex tw-items-center tw-gap-2">
                <span>File Context</span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="tw-size-4 tw-text-muted" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="tw-max-w-80">
                        <strong>Supported File Types:</strong>
                        <br />
                        <strong>• Documents:</strong> pdf, doc, docx, ppt, pptx, epub, txt, rtf and
                        many more
                        <br />
                        <strong>• Images:</strong> jpg, png, svg, gif, bmp, webp, tiff
                        <br />
                        <strong>• Spreadsheets:</strong> xlsx, xls, csv, numbers
                        <br />
                        <br />
                        Non-markdown files are converted to markdown in the background.
                        <br />
                        <strong>Rate limit:</strong> 50 files or 100MB per 3 hours, whichever is
                        reached first.
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            }
            description="Define patterns to include specific files, folders or tags (specified in the note property) in the project context."
          >
            <div className="tw-flex tw-items-center tw-gap-2">
              <div className="tw-flex tw-flex-1 tw-flex-row">
                <TruncatedText className="tw-max-w-[100px] tw-text-sm tw-text-accent">
                  {showContext}
                </TruncatedText>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  handleEditProjectContext(formData);
                }}
              >
                Manage Context
              </Button>
            </div>
          </FormField>

          <FormField label="Web URLs">
            <Textarea
              value={formData.contextSource?.webUrls}
              onChange={(e) => {
                const urls = e.target.value.split("\n");

                // Process each URL while preserving spaces and empty lines
                const processedUrls = urls.map((url) => {
                  if (!url.trim()) return url; // Preserve empty lines and whitespace-only lines
                  try {
                    new URL(url.trim());
                    return url; // Keep original formatting including spaces
                  } catch {
                    return url; // Keep invalid URLs for user to fix
                  }
                });

                handleInputChange("contextSource.webUrls", processedUrls.join("\n"));
              }}
              placeholder="Enter web URLs, one per line"
              className="tw-min-h-20 tw-w-full"
            />
          </FormField>

          <FormField label="YouTube URLs">
            <Textarea
              value={formData.contextSource?.youtubeUrls}
              onChange={(e) => {
                const urls = e.target.value.split("\n");

                // Process each URL while preserving spaces and empty lines
                const processedUrls = urls.map((url) => {
                  if (!url.trim()) return url; // Preserve empty lines and whitespace-only lines
                  try {
                    const urlObj = new URL(url.trim());
                    if (
                      urlObj.hostname.includes("youtube.com") ||
                      urlObj.hostname.includes("youtu.be")
                    ) {
                      return url; // Keep original formatting including spaces
                    }
                    return url; // Keep non-YouTube URLs for user to fix
                  } catch {
                    return url; // Keep invalid URLs for user to fix
                  }
                });

                handleInputChange("contextSource.youtubeUrls", processedUrls.join("\n"));
              }}
              placeholder="Enter YouTube URLs, one per line"
              className="tw-min-h-20 tw-w-full"
            />
          </FormField>
        </div>
      </div>

      <div className="tw-mt-4 tw-flex tw-items-center tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSubmitting || !isFormValid()}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

export class AddProjectModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onSave: (project: ProjectConfig) => Promise<void>,
    private initialProject?: ProjectConfig
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

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
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
