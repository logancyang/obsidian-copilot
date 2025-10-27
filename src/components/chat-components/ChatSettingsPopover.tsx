import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, RotateCcw, Settings, Settings2 } from "lucide-react";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ModelParametersEditor } from "@/components/ui/ModelParametersEditor";
import { CustomModel, getModelKey } from "@/aiParams";
import { getSettings, updateSetting } from "@/settings/model";
import { debounce } from "@/utils";
import {
  getDefaultSystemPromptTitle,
  getDisableBuiltinSystemPrompt,
  setDisableBuiltinSystemPrompt,
  SystemPromptManagerModal,
  useSelectedPrompt,
  useSystemPrompts,
} from "@/system-prompts";

interface ChatSettingsPopoverProps {
  onManagePrompts?: () => void;
}

export function ChatSettingsPopover({ onManagePrompts }: ChatSettingsPopoverProps) {
  const settings = getSettings();
  const modelKey = getModelKey();

  // Find the currently selected model (original model)
  const originalModel = settings.activeModels.find(
    (model) => `${model.name}|${model.provider}` === modelKey
  );

  // Local editing state
  const [localModel, setLocalModel] = useState<CustomModel | undefined>(originalModel);

  // System prompt state (session-level, in-memory)
  const prompts = useSystemPrompts();
  const [sessionPrompt, setSessionPrompt] = useSelectedPrompt();
  const globalDefault = getDefaultSystemPromptTitle();

  /**
   * Check if a prompt title exists in the current prompts list
   */
  const promptExists = (title: string | null | undefined): boolean => {
    if (!title) return false;
    return prompts.some((p) => p.title === title);
  };

  // Display value: use existing prompts only, otherwise show placeholder
  const displayValue = promptExists(sessionPrompt)
    ? sessionPrompt
    : promptExists(globalDefault)
      ? globalDefault
      : "";

  // Read state from session atom
  const [disableBuiltin, setDisableBuiltin] = useState(getDisableBuiltinSystemPrompt());
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Update local state when original model changes (e.g., switching models)
  useEffect(() => {
    setLocalModel(originalModel);
  }, [originalModel]);

  /**
   * Sync global disableBuiltinSystemPrompt state to local UI state when popover opens
   * This ensures the UI reflects the current state after chat switches (new chat or load history)
   */
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      const currentValue = getDisableBuiltinSystemPrompt();
      setDisableBuiltin(currentValue);
      if (!currentValue) {
        setShowConfirmation(false);
      }
    }
  }, []);

  // Debounced save function
  const debouncedSave = useMemo(
    () =>
      debounce((updatedModel: CustomModel) => {
        const updatedModels = settings.activeModels.map((model) =>
          `${model.name}|${model.provider}` === modelKey ? updatedModel : model
        );
        updateSetting("activeModels", updatedModels);
      }, 500),
    [settings.activeModels, modelKey]
  );

  /**
   * Update model parameters (immediately update UI, delayed save)
   */
  const handleParamChange = useCallback(
    (field: keyof CustomModel, value: any) => {
      if (!localModel) return;

      const updatedModel = { ...localModel, [field]: value };
      setLocalModel(updatedModel);
      debouncedSave(updatedModel);
    },
    [localModel, debouncedSave]
  );

  /**
   * Reset parameters (delete model-specific values, revert to global defaults)
   */
  const handleParamReset = useCallback(
    (field: keyof CustomModel) => {
      if (!localModel) return;

      const updatedModel = { ...localModel };
      delete updatedModel[field];
      setLocalModel(updatedModel);
      debouncedSave(updatedModel);
    },
    [localModel, debouncedSave]
  );

  const handleReset = useCallback(() => {
    // Reset all optional parameters
    if (localModel) {
      handleParamReset("topP");
      handleParamReset("frequencyPenalty");
      handleParamReset("reasoningEffort");
      handleParamReset("verbosity");
    }
    // Reset session prompt to use global default
    setSessionPrompt("");
    setDisableBuiltin(false);
    setShowConfirmation(false);
    // Clear session settings
    setDisableBuiltinSystemPrompt(false);
  }, [localModel, handleParamReset, setSessionPrompt]);

  const handleDisableBuiltinToggle = (checked: boolean) => {
    if (checked) {
      setShowConfirmation(true);
    } else {
      setDisableBuiltin(false);
      setShowConfirmation(false);
      // Update session settings
      setDisableBuiltinSystemPrompt(false);
    }
  };

  const confirmDisableBuiltin = () => {
    setDisableBuiltin(true);
    setShowConfirmation(false);
    // Update session settings
    setDisableBuiltinSystemPrompt(true);
  };

  const cancelDisableBuiltin = () => {
    setShowConfirmation(false);
  };

  const handleManagePrompts = () => {
    const modal = new SystemPromptManagerModal(app);
    modal.open();
  };

  if (!localModel) {
    return null;
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost2" size="icon" title="Open Chat Setting">
          <Settings className="tw-size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="tw-w-80 tw-rounded-md tw-p-0" align="end">
        <div className="tw-flex tw-max-h-[500px] tw-flex-col">
          {/* Header with Reset - Fixed */}
          <div className="tw-shrink-0 tw-border-b tw-px-4">
            <div className="tw-flex tw-items-center tw-justify-between">
              <h3 className="tw-font-semibold">Chat Settings</h3>
              <Button variant="ghost" size="sm" onClick={handleReset} className="tw-h-8 tw-text-xs">
                <RotateCcw className="tw-mr-1 tw-size-3" />
                Reset
              </Button>
            </div>
          </div>

          <Separator />

          {/* Scrollable Content Area */}
          <ScrollArea className="tw-flex-1 tw-overflow-y-auto">
            <div className="tw-space-y-4 tw-p-4">
              {/* System Prompt */}
              <div className="tw-space-y-2">
                <div className="tw-flex tw-flex-col tw-gap-2 sm:tw-flex-row sm:tw-items-center sm:tw-justify-between">
                  <Label htmlFor="system-prompt" className="tw-text-sm sm:tw-min-w-fit">
                    System Prompt
                  </Label>
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 sm:tw-flex-1">
                    <ObsidianNativeSelect
                      value={displayValue}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Only update if a valid prompt is selected
                        if (value && promptExists(value)) {
                          setSessionPrompt(value);
                        }
                      }}
                      options={prompts.map((prompt) => ({
                        label:
                          prompt.title === globalDefault
                            ? `${prompt.title} (Global)`
                            : prompt.title,
                        value: prompt.title,
                      }))}
                      placeholder="Select system prompt"
                      containerClassName="tw-flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="tw-size-9 tw-shrink-0"
                      onClick={handleManagePrompts}
                      title="Manage System Prompts"
                    >
                      <Settings2 className="tw-size-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Model Parameters Editor */}
              <ModelParametersEditor
                model={localModel}
                settings={settings}
                onChange={handleParamChange}
                onReset={handleParamReset}
                showTokenLimit={true}
              />

              <Separator />

              {/* Disable Builtin System Prompt */}
              <div className="tw-space-y-3">
                <div className="tw-space-y-1.5">
                  <div className="tw-flex tw-items-center tw-justify-between">
                    <Label htmlFor="disable-builtin" className="tw-text-sm tw-font-medium">
                      Disable Builtin System Prompt
                    </Label>
                    <SettingSwitch
                      checked={disableBuiltin}
                      onCheckedChange={handleDisableBuiltinToggle}
                      disabled={showConfirmation}
                    />
                  </div>
                  <div className="tw-pr-12 tw-text-xs tw-leading-relaxed tw-text-muted">
                    Disables the builtin system prompt and only uses your custom system prompt.{" "}
                    <span className="tw-text-xs tw-text-error">
                      WARNING: This may break expected functionality.
                    </span>
                  </div>
                </div>

                {(disableBuiltin || showConfirmation) && (
                  <div className="tw-rounded-md tw-border tw-bg-error/10 tw-p-3 tw-border-error/50">
                    <div className="tw-flex tw-gap-2">
                      <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-error" />
                      <div className="tw-flex-1 tw-space-y-2">
                        <div className="tw-space-y-1">
                          <div className="tw-text-xs tw-font-semibold tw-text-error">
                            Copilot Plus Features Will Become Unavailable
                          </div>
                          <div className="tw-flex tw-flex-col  tw-items-center tw-gap-2 tw-text-xs tw-leading-relaxed tw-text-muted">
                            <div>
                              When enabled, advanced features such as vault search, web search, and
                              agent mode will become unavailable.{" "}
                            </div>
                            <div className="tw-italic">
                              Only your custom system prompt (configured in Settings) will be used.
                            </div>
                          </div>
                        </div>

                        {showConfirmation && (
                          <div className="tw-flex tw-gap-2 tw-pt-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={confirmDisableBuiltin}
                              className="tw-h-7 tw-text-xs"
                            >
                              Disable Builtin
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelDisableBuiltin}
                              className="tw-h-7 tw-bg-transparent tw-text-xs"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <Separator />

          {/* Footer - Fixed */}
          <div className="tw-shrink-0 tw-rounded-md tw-bg-primary tw-px-4 tw-py-1">
            <div className="tw-flex tw-flex-row tw-flex-wrap">
              <span className="tw-text-xs tw-text-normal">
                <span className=" tw-italic">System Prompt and Disable Builtin System Prompt</span>{" "}
                <strong>apply to this chat session only</strong>;
                <br />
                other settings are <strong>bound to the current model</strong>.
              </span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
