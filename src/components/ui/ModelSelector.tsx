import React, { useState } from "react";
import { Notice } from "obsidian";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelDisplay } from "@/components/ui/model-display";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { checkModelApiKey, err2String } from "@/utils";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getApiKeyForProvider,
  isRequiredChatModel,
  providerRequiresApiKey,
} from "@/utils/modelUtils";

interface ModelSelectorProps {
  disabled?: boolean;
  size?: "sm" | "fit" | "default" | "lg" | "icon";
  variant?: "default" | "destructive" | "secondary" | "ghost" | "ghost2" | "link" | "success";
  className?: string;
  // Always controlled
  value: string;
  onChange: (modelKey: string) => void;
}

export function ModelSelector({
  disabled = false,
  size = "fit",
  variant = "ghost2",
  className,
  value,
  onChange,
}: ModelSelectorProps) {
  const [modelError, setModelError] = useState<string | null>(null);
  const settings = useSettingsValue();

  const currentModel = settings.activeModels.find(
    (model) => model.enabled && getModelKeyFromModel(model) === value
  );

  // Filter models: show required models, local models, or models with valid API keys
  const showModels = settings.activeModels.filter((model) => {
    const isRequired = isRequiredChatModel(model);
    if (isRequired) {
      return true;
    }

    // Local providers don't require API keys
    if (!providerRequiresApiKey(model.provider)) {
      return true;
    }

    // Cloud providers need API keys
    const hasApiKey = !!getApiKeyForProvider(model.provider, model);
    return hasApiKey;
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          className={cn("tw-min-w-0 tw-justify-start tw-text-muted", className)}
        >
          <div className="tw-min-w-0 tw-flex-1 tw-truncate">
            {modelError ? (
              <span className="tw-truncate tw-text-error">Model Load Failed</span>
            ) : currentModel ? (
              <ModelDisplay model={currentModel} iconSize={8} />
            ) : (
              <span className="tw-truncate">Select Model</span>
            )}
          </div>
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-5 tw-shrink-0" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {showModels
          .filter((model) => model.enabled)
          .map((model) => {
            const { hasApiKey, errorNotice } = checkModelApiKey(model, settings);
            return (
              <DropdownMenuItem
                key={getModelKeyFromModel(model)}
                onSelect={async (event) => {
                  if (!hasApiKey && errorNotice) {
                    event.preventDefault();
                    new Notice(errorNotice);
                    return;
                  }

                  try {
                    setModelError(null);
                    onChange(getModelKeyFromModel(model));
                  } catch (error) {
                    const msg = `Model switch failed: ` + err2String(error);
                    setModelError(msg);
                    new Notice(msg);
                    // Restore to the last valid model
                    const lastValidModel = showModels.find(
                      (m) => m.enabled && getModelKeyFromModel(m) === value
                    );
                    if (lastValidModel) {
                      onChange(getModelKeyFromModel(lastValidModel));
                    }
                  }
                }}
                className={!hasApiKey ? "tw-cursor-not-allowed tw-opacity-50" : ""}
              >
                <ModelDisplay model={model} iconSize={12} />
              </DropdownMenuItem>
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
