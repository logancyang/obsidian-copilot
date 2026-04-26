import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelDisplay } from "@/components/ui/model-display";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { checkModelApiKey, err2String } from "@/utils";
import type { CustomModel } from "@/aiParams";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Picker entry shape. The selector is normally driven by `settings.activeModels`,
 * but callers can pass an explicit `models` list (e.g. Agent Mode merges
 * Copilot-configured models with backend-reported ones). To surface a
 * non-API-key reason for a disabled option, set `_disabledReason` on the
 * synthetic entry; the selector will render the option disabled with the
 * reason as a right-side label.
 *
 * `_group` opts entries into section headers in the dropdown — when
 * consecutive entries have differing `_group` values, a non-clickable label
 * is rendered before the next group. Used by Agent Mode to subtitle
 * per-backend sections (e.g. `opencode`, `Claude Code`). Backwards
 * compatible — entries without `_group` render flat as today.
 *
 * Agent Mode tags every entry with `_backendId` so the selector can route
 * the selected key back to the right backend, and so the React key /
 * dropdown value can stay unique even when two backends report the same
 * agent-native model id (e.g. both surface a `sonnet` alias). Synthesized
 * agent entries (no Copilot `CustomModel` backing) also carry the raw
 * agent model id in `_agentModelId` so callers can resolve the original id
 * after we scope `name` for uniqueness.
 */
export type ModelSelectorEntry = CustomModel & {
  _disabledReason?: string;
  _group?: string;
  _backendId?: string;
  _agentModelId?: string;
};

interface ModelSelectorProps {
  disabled?: boolean;
  size?: "sm" | "fit" | "default" | "lg" | "icon";
  variant?: "default" | "destructive" | "secondary" | "ghost" | "ghost2" | "link" | "success";
  className?: string;
  // Always controlled
  value: string;
  onChange: (modelKey: string) => void;
  /**
   * Optional override for the list of models to show. When provided, the
   * selector skips the BYOK API-key check — the caller is responsible for
   * marking unusable entries via `_disabledReason`.
   */
  models?: ModelSelectorEntry[];
}

export function ModelSelector({
  disabled = false,
  size = "fit",
  variant = "ghost2",
  className,
  value,
  onChange,
  models,
}: ModelSelectorProps) {
  const [modelError, setModelError] = useState<string | null>(null);
  const settings = useSettingsValue();

  const showModels: ModelSelectorEntry[] = models ?? settings.activeModels;
  const skipApiKeyCheck = models !== undefined;

  const currentModel = showModels.find(
    (model) => (model.enabled ?? true) && getModelKeyFromModel(model) === value
  );

  const visible = showModels.filter((model) => model.enabled !== false);
  let lastGroup: string | undefined;

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

      <DropdownMenuContent align="start" className="tw-max-h-64 tw-overflow-y-auto">
        {visible.map((model) => {
          const disabledReason = model._disabledReason;
          const hasApiKey = skipApiKeyCheck ? true : checkModelApiKey(model, settings).hasApiKey;
          const itemDisabled = Boolean(disabledReason) || !hasApiKey;
          const rightLabel = disabledReason ?? (!hasApiKey ? "Needs API key" : null);
          const showHeader = model._group !== undefined && model._group !== lastGroup;
          const headerKey = `__group__${model._group}__${getModelKeyFromModel(model)}`;
          lastGroup = model._group;
          return (
            <React.Fragment key={getModelKeyFromModel(model)}>
              {showHeader && (
                <DropdownMenuLabel
                  key={headerKey}
                  className="tw-text-xs tw-uppercase tw-tracking-wide tw-text-faint"
                >
                  {model._group}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem
                disabled={itemDisabled}
                title={disabledReason ?? undefined}
                onSelect={async (event) => {
                  if (itemDisabled) {
                    event.preventDefault();
                    return;
                  }

                  try {
                    setModelError(null);
                    onChange(getModelKeyFromModel(model));
                  } catch (error) {
                    const msg = `Model switch failed: ` + err2String(error);
                    setModelError(msg);
                    // Restore to the last valid model
                    const lastValidModel = showModels.find(
                      (m) => m.enabled !== false && getModelKeyFromModel(m) === value
                    );
                    if (lastValidModel) {
                      onChange(getModelKeyFromModel(lastValidModel));
                    }
                  }
                }}
                className={itemDisabled ? "tw-cursor-not-allowed tw-opacity-50" : ""}
              >
                <ModelDisplay model={model} iconSize={12} />
                {rightLabel && (
                  <span className="tw-ml-auto tw-text-smallest tw-text-faint">{rightLabel}</span>
                )}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
