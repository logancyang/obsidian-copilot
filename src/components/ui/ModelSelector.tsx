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
import { useSettingsValue, getModelKeyFromModel } from "@/settings/model";
import { checkModelApiKey, err2String } from "@/utils";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          className={cn("tw-text-muted", className)}
        >
          {modelError ? (
            <span className="tw-text-error">Model Load Failed</span>
          ) : currentModel ? (
            <ModelDisplay model={currentModel} iconSize={8} />
          ) : (
            "Select Model"
          )}
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-5" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {settings.activeModels
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
                    const lastValidModel = settings.activeModels.find(
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
