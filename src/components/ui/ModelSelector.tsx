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
import { LicenseRequiredIcon } from "@/components/ui/LicenseRequiredIcon";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { SelfHostCloudWarningIcon } from "@/components/ui/SelfHostCloudWarningIcon";
import { checkModelApiKey, err2String } from "@/lib/model-display-utils";
import type { ModelApiKeySettings } from "@/lib/model-display-utils";
import { getModelKeyFromModel } from "@/lib/model-key";
import type { CustomModel } from "@/aiParams";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PICKER_PRICING_URL = createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "model_picker_lock");

export type ModelSelectorEntry = CustomModel & {
  _disabledReason?: string;
  _group?: string;
  _backendId?: string;
  _subtitle?: string;
  _isFree?: boolean;
  _needsSelfHostWarning?: boolean;
  _needsLicense?: boolean;
};

interface ModelSelectorProps {
  disabled?: boolean;
  size?: "sm" | "fit" | "default" | "lg" | "icon";
  variant?: "default" | "destructive" | "secondary" | "ghost" | "ghost2" | "link" | "success";
  className?: string;
  value: string;
  onChange: (modelKey: string) => void;
  models: ModelSelectorEntry[];
  apiKeySettings?: Readonly<ModelApiKeySettings>;
}

export function ModelSelector({
  disabled = false,
  size = "fit",
  variant = "ghost2",
  className,
  value,
  onChange,
  models,
  apiKeySettings,
}: ModelSelectorProps) {
  const [modelError, setModelError] = useState<string | null>(null);

  const currentModel = models.find(
    (model) => (model.enabled ?? true) && getModelKeyFromModel(model) === value
  );

  const visible = models.filter((model) => model.enabled !== false);
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
          {currentModel?._needsSelfHostWarning && (
            <SelfHostCloudWarningIcon className="tw-mt-0.5" stopPropagation={false} />
          )}
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-5 tw-shrink-0" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="tw-max-h-64 tw-overflow-y-auto">
        {visible.map((model) => {
          const disabledReason = model._disabledReason;
          const hasApiKey = apiKeySettings
            ? checkModelApiKey(model, apiKeySettings).hasApiKey
            : true;
          const itemDisabled = Boolean(disabledReason) || !hasApiKey;
          const rightLabel = model._needsLicense
            ? null
            : (disabledReason ?? (!hasApiKey ? "Needs API key" : null));
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
                disabled={itemDisabled && !model._needsLicense}
                title={disabledReason ?? undefined}
                onSelect={(event) => {
                  if (model._needsLicense) {
                    (event.currentTarget as HTMLElement).win.open(
                      PICKER_PRICING_URL,
                      "_blank",
                      "noopener,noreferrer"
                    );
                    return;
                  }
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
                    const lastValidModel = models.find(
                      (m) => m.enabled !== false && getModelKeyFromModel(m) === value
                    );
                    if (lastValidModel) {
                      onChange(getModelKeyFromModel(lastValidModel));
                    }
                  }
                }}
                className={cn(
                  itemDisabled && "tw-opacity-50",
                  itemDisabled && !model._needsLicense && "tw-cursor-not-allowed"
                )}
              >
                <div className="tw-min-w-0">
                  <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                    <ModelDisplay model={model} iconSize={12} />
                    {model._needsLicense && <LicenseRequiredIcon />}
                    {model._needsSelfHostWarning && <SelfHostCloudWarningIcon />}
                  </div>
                  {model._subtitle && (
                    <div className="tw-truncate tw-text-xs tw-text-muted">{model._subtitle}</div>
                  )}
                </div>
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
