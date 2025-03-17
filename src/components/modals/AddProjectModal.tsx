import { App, Modal, Notice } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { err2String, checkModelApiKey, randomUUID } from "@/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { ProjectConfig } from "@/aiParams";
import { useSettingsValue, getModelKeyFromModel } from "@/settings/model";
import { getModelDisplayWithIcons } from "@/components/ui/model-display";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { SettingSlider } from "@/components/ui/setting-slider";
import { PatternMatchingModal } from "@/components/modals/PatternMatchingModal";

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

  const [formData, setFormData] = useState<Partial<ProjectConfig>>(
    initialProject || {
      id: randomUUID(),
      name: "",
      description: "",
      systemPrompt: "",
      projectModelKey: "",
      modelConfigs: {
        temperature: 1.0,
        maxTokens: 1000,
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

  const isFormValid = () => {
    return (
      formData.name &&
      formData.systemPrompt &&
      formData.projectModelKey &&
      formData.contextSource?.inclusions?.trim()
    );
  };

  const handleInputChange = (
    field: string,
    value: string | number | string[] | Record<string, any>
  ) => {
    setFormData((prev) => {
      // Handle text input
      if (typeof value === "string") {
        value = value.trim();
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
    const requiredFields = ["name", "systemPrompt", "projectModelKey"];
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
    <div className="flex flex-col gap-2 p-4">
      <div className="text-xl font-bold text-normal mb-2">Add New Project</div>

      <div className="flex flex-col gap-2">
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
            className="w-full"
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
            className="w-full"
          />
        </FormField>

        <FormField
          label="Prompt"
          required
          error={touched.systemPrompt && !formData.systemPrompt}
          errorMessage="System prompt is required"
        >
          <Textarea
            value={formData.systemPrompt}
            onChange={(e) => handleInputChange("systemPrompt", e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, systemPrompt: true }))}
            className="min-h-[8rem]"
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
              .filter((m) => m.enabled)
              .map((model) => ({
                label: getModelDisplayWithIcons(model),
                value: getModelKeyFromModel(model),
              }))}
          />
        </FormField>

        <div className="space-y-4">
          <div className="text-base font-medium">Model Configuration</div>
          <div className="grid grid-cols-1 gap-4">
            <FormField label="Temperature">
              <SettingSlider
                value={formData.modelConfigs?.temperature ?? 1}
                onChange={(value) => handleInputChange("modelConfigs.temperature", value)}
                min={0}
                max={2}
                step={0.01}
                className="w-full"
              />
            </FormField>
            <FormField label="Token Limit">
              <SettingSlider
                value={formData.modelConfigs?.maxTokens ?? 1000}
                onChange={(value) => handleInputChange("modelConfigs.maxTokens", value)}
                min={1}
                max={16000}
                step={1}
                className="w-full"
              />
            </FormField>
          </div>
        </div>

        <div className="space-y-4">
          <div className="text-base font-medium">Context Sources</div>
          <FormField
            label="Inclusions"
            required
            error={touched.inclusions && !formData.contextSource?.inclusions?.trim()}
            errorMessage="At least one inclusion pattern is required"
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 text-xs text-muted">
                {formData.contextSource?.inclusions?.trim()
                  ? "Patterns configured"
                  : "No patterns configured"}
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  new PatternMatchingModal(
                    app,
                    (value: string) => {
                      handleInputChange("contextSource.inclusions", value);
                      setTouched((prev) => ({ ...prev, inclusions: true }));
                    },
                    formData.contextSource?.inclusions || "",
                    "Manage Inclusions"
                  ).open()
                }
              >
                Manage Patterns
              </Button>
            </div>
          </FormField>

          <FormField
            label="Exclusions"
            description="Exclude specific files or patterns from the included folders above"
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 text-xs text-muted">
                {formData.contextSource?.exclusions?.trim()
                  ? "Patterns configured"
                  : "No patterns configured"}
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  new PatternMatchingModal(
                    app,
                    (value: string) => {
                      handleInputChange("contextSource.exclusions", value);
                    },
                    formData.contextSource?.exclusions || "",
                    "Manage Exclusions"
                  ).open()
                }
              >
                Manage Patterns
              </Button>
            </div>
          </FormField>

          <FormField label="Web URLs">
            <Textarea
              value={formData.contextSource?.webUrls}
              onChange={(e) => {
                const urls = e.target.value
                  .split("\n")
                  .map((url) => url.trim())
                  .filter((url) => {
                    if (!url) return false;
                    try {
                      new URL(url);
                      return true;
                    } catch {
                      return false;
                    }
                  })
                  .join("\n");
                handleInputChange("contextSource.webUrls", urls);
              }}
              placeholder="Enter web URLs, one per line"
              className="min-h-[80px] w-full"
            />
          </FormField>

          <FormField label="YouTube URLs">
            <Textarea
              value={formData.contextSource?.youtubeUrls}
              onChange={(e) => {
                const urls = e.target.value
                  .split("\n")
                  .map((url) => url.trim())
                  .filter((url) => {
                    if (!url) return false;
                    try {
                      const urlObj = new URL(url);
                      return (
                        urlObj.hostname.includes("youtube.com") ||
                        urlObj.hostname.includes("youtu.be")
                      );
                    } catch {
                      return false;
                    }
                  })
                  .join("\n");
                handleInputChange("contextSource.youtubeUrls", urls);
              }}
              placeholder="Enter YouTube URLs, one per line"
              className="min-h-[80px] w-full"
            />
          </FormField>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-4">
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
