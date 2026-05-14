import { ProjectConfig } from "@/aiParams";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { openCachedItemPreview } from "@/utils/cacheFileOpener";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { ProcessingStatus } from "@/components/project/processing-status";
import { useProjectProcessingData } from "@/components/project/useProjectProcessingData";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { getModelDisplayWithIcons } from "@/components/ui/model-display";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingSlider } from "@/components/ui/setting-slider";
import { Textarea } from "@/components/ui/textarea";
import { UrlTagInput } from "@/components/ui/url-tag-input";
import { SystemPromptSyntaxInstruction } from "@/components/SystemPromptSyntaxInstruction";
import { DEFAULT_MODEL_SETTING } from "@/constants";
import { ProjectContextBadgeList } from "@/components/project/ProjectContextBadgeList";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { checkModelApiKey, err2String, randomUUID } from "@/utils";
import { Settings } from "lucide-react";
import { type UrlItem, parseProjectUrls, serializeProjectUrls } from "@/utils/urlTagUtils";
import type CopilotPlugin from "@/main";
import { App, Modal, Notice } from "obsidian";
import React, { useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";

interface AddProjectModalContentProps {
  initialProject?: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<void>;
  onCancel: () => void;
  plugin?: CopilotPlugin;
}

function AddProjectModalContent({
  initialProject,
  onSave,
  onCancel,
  plugin,
}: AddProjectModalContentProps) {
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

  // URL items derived from formData for UrlTagInput
  const urlItems = useMemo(
    () =>
      parseProjectUrls(
        formData.contextSource?.webUrls || "",
        formData.contextSource?.youtubeUrls || ""
      ),
    [formData.contextSource?.webUrls, formData.contextSource?.youtubeUrls]
  );

  // Reason: Shared hook handles cache loading, file enumeration, and processingData construction.
  // contextSource draft is passed so newly added (unsaved) URLs appear as "Pending".
  const { processingData, projectCache, isCurrentProject } = useProjectProcessingData({
    cacheProject: initialProject ?? null,
    contextSource: formData.contextSource,
  });

  const handleEditProjectContext = (projectDraft: ProjectConfig) => {
    const modal = new ContextManageModal(
      app,
      (updatedProject: ProjectConfig) => {
        // Reason: Only merge inclusions/exclusions (what ContextManageModal edits).
        // Don't replace the entire contextSource — that would overwrite any
        // webUrls/youtubeUrls changes the user made in AddProjectModal while
        // the child modal was open.
        setFormData((prev) => ({
          ...prev,
          contextSource: {
            ...prev.contextSource,
            inclusions: updatedProject.contextSource?.inclusions,
            exclusions: updatedProject.contextSource?.exclusions,
          },
        }));
      },
      projectDraft
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
      if (typeof value === "string") {
        if (field === "projectModelKey") {
          value = value.trim();
        }
      }
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        value = (value as string[]).map((item) => item.trim()).filter(Boolean);
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

  /** Handle URL adds from UrlTagInput, serialize back to formData strings */
  const handleUrlAdd = (newUrls: UrlItem[]) => {
    const allUrls = [...urlItems, ...newUrls];
    const { webUrls, youtubeUrls } = serializeProjectUrls(allUrls);
    handleInputChange("contextSource.webUrls", webUrls);
    handleInputChange("contextSource.youtubeUrls", youtubeUrls);
  };

  /** Handle URL removal from UrlTagInput */
  const handleUrlRemove = (id: string) => {
    const remaining = urlItems.filter((u) => u.id !== id);
    const { webUrls, youtubeUrls } = serializeProjectUrls(remaining);
    handleInputChange("contextSource.webUrls", webUrls);
    handleInputChange("contextSource.youtubeUrls", youtubeUrls);
  };

  /** Handle inclusions pattern changes from badge list deletion */
  const handleInclusionsChange = (value: string) => {
    handleInputChange("contextSource.inclusions", value);
  };

  /** Handle exclusions pattern changes from badge list deletion */
  const handleExclusionsChange = (value: string) => {
    handleInputChange("contextSource.exclusions", value);
  };

  /** Handle opening cached parsed content for any item (file or URL) */
  const handleOpenCachedItem = (item: ProcessingItem) => {
    void openCachedItemPreview(app, projectCache, item);
  };

  /** Handle removing a failed URL from the project config via ProcessingStatus × button */
  const handleRemoveUrl = (item: ProcessingItem) => {
    // Reason: ProcessingItem.id is the raw URL, while UrlItem.id is "type:url".
    // Match by url field and cacheKind to avoid ID format mismatch.
    const targetType = item.cacheKind === "youtube" ? "youtube" : "web";
    const remaining = urlItems.filter((u) => !(u.type === targetType && u.url === item.id));
    const { webUrls, youtubeUrls } = serializeProjectUrls(remaining);
    handleInputChange("contextSource.webUrls", webUrls);
    handleInputChange("contextSource.youtubeUrls", youtubeUrls);
  };

  /** Handle retry for failed processing items */
  const handleRetry = (itemId: string) => {
    if (!plugin?.projectManager || !processingData) return;
    const failedItem = processingData.failedItemMap.get(itemId);
    if (failedItem) {
      void plugin.projectManager.retryFailedItem(failedItem);
    }
  };

  const handleSave = async () => {
    const trimmedName = formData.name?.trim() ?? "";
    const saveData = { ...formData, name: trimmedName };

    const requiredFields = ["name", "projectModelKey"];
    const missingFields = requiredFields.filter((field) => !saveData[field as keyof ProjectConfig]);

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
      await onSave(saveData);
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
      {/* Header */}
      <div className="tw-shrink-0 tw-px-4 tw-pb-2 tw-pt-4">
        <div className="tw-text-xl tw-font-bold tw-text-normal">
          {initialProject ? "Edit Project" : "New Project"}
        </div>
        <p className="tw-mt-1 tw-text-sm tw-text-muted">
          Configure your project settings and context sources
        </p>
      </div>

      {/* Scrollable Content */}
      <ScrollArea className="tw-min-h-0 tw-flex-1">
        <div className="tw-flex tw-flex-col tw-gap-6 tw-p-4">
          {/* Basic Info Card */}
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

              <FormField
                label="Project System Prompt"
                description="Custom instructions for how the AI should behave in this project context"
              >
                <SystemPromptSyntaxInstruction />
                <Textarea
                  value={formData.systemPrompt}
                  onChange={(e) => handleInputChange("systemPrompt", e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, systemPrompt: true }))}
                  placeholder="Enter your project system prompt here... Use {[[Note Name]]} to include note contents."
                  className="tw-min-h-32"
                />
              </FormField>
            </div>
          </div>

          {/* Model Configuration Card */}
          <div className="tw-rounded-lg tw-border tw-border-border tw-p-4 tw-bg-secondary/50">
            <h3 className="tw-mb-3 tw-text-sm tw-font-medium tw-text-normal">
              Model Configuration
            </h3>
            <div className="tw-flex tw-flex-col tw-gap-3">
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
                      // Keep selection allowed; error will surface in chat on send
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

          {/* Context Sources Card */}
          <div className="tw-rounded-lg tw-border tw-border-border tw-p-4 tw-bg-secondary/50">
            <h3 className="tw-mb-3 tw-text-sm tw-font-medium tw-text-normal">Context Sources</h3>
            <div className="tw-flex tw-flex-col tw-gap-4">
              {/* File Context Sub-card */}
              <div className="tw-rounded-lg tw-border tw-border-border tw-p-4">
                <FormField
                  label={
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <span>File Context</span>
                      <HelpTooltip
                        buttonClassName="tw-size-4 tw-text-muted"
                        content={
                          <div className="tw-max-w-80">
                            <strong>Supported File Types:</strong>
                            <br />
                            <strong>• Documents:</strong> pdf, doc, docx, ppt, pptx, epub, txt, rtf
                            and many more
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
                        }
                      />
                    </div>
                  }
                  description="Define patterns to include specific files, folders or tags (specified in the note property) in the project context."
                >
                  <ProjectContextBadgeList
                    inclusions={formData.contextSource?.inclusions}
                    exclusions={formData.contextSource?.exclusions}
                    onInclusionsChange={handleInclusionsChange}
                    onExclusionsChange={handleExclusionsChange}
                    actionSlot={
                      <Button
                        size="lg"
                        className="tw-h-9 tw-gap-1 tw-px-3 sm:tw-h-auto sm:tw-px-2"
                        onClick={() => handleEditProjectContext(formData)}
                      >
                        <Settings className="tw-size-4 sm:tw-size-3.5" />
                        Manage Context
                      </Button>
                    }
                  />
                </FormField>
              </div>

              {/* URLs Sub-card */}
              <div className="tw-rounded-lg tw-border tw-border-border tw-p-4">
                <div className="tw-mb-3">
                  <span className="tw-text-sm tw-font-medium tw-text-normal">URLs</span>
                  <p className="tw-mt-1 tw-text-ui-smaller tw-text-muted">
                    Add web pages or YouTube videos as context sources
                  </p>
                </div>
                <UrlTagInput urls={urlItems} onAdd={handleUrlAdd} onRemove={handleUrlRemove} />
              </div>
            </div>
          </div>

          {/* Processing Status - show for any project in edit mode (active: live state; others: cache state) */}
          {initialProject && processingData && (
            <ProcessingStatus
              items={processingData.items}
              onRetry={isCurrentProject ? handleRetry : undefined}
              onOpenCachedItem={projectCache != null ? handleOpenCachedItem : undefined}
              onRemoveUrl={handleRemoveUrl}
              defaultExpanded={false}
              maxHeight="200px"
            />
          )}
        </div>
      </ScrollArea>

      {/* Sticky Footer */}
      <div className="tw-shrink-0 tw-border-t tw-border-border tw-px-4 tw-py-3">
        <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !isFormValid()}>
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

    // Reason: Ensure the modal is wide enough for card layout and tall enough for ScrollArea
    modalEl.addClass("!tw-max-h-[85vh]");

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
        plugin={this.plugin}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
