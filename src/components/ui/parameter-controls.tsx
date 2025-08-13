import React, { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, Zap, ZapOff } from "lucide-react";

interface ParameterControlProps {
  label: string;
  value?: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step: number;
  defaultValue?: number;
  helpText?: React.ReactNode;
  disableFn?: () => void;
  optional?: boolean;
}

export function ParameterControl({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  defaultValue = 0,
  helpText,
  disableFn,
  optional = true,
}: ParameterControlProps) {
  const [isEnabled, setIsEnabled] = useState(optional ? value !== undefined : true);

  const handleToggleEnabled = () => {
    if (!optional) return; // Disable switching function in mandatory mode.

    setIsEnabled(!isEnabled);
    if (!isEnabled) {
      // When enabling, set to current value or default
      onChange(value ?? defaultValue);
    } else {
      disableFn?.();
    }
  };

  const handleValueChange = (newValue: number[]) => {
    if (isEnabled) {
      onChange(newValue[0]);
    }
  };

  return (
    <div className="tw-space-y-3">
      <TooltipProvider delayDuration={0}>
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className={`tw-font-medium ${isEnabled ? "tw-text-normal" : "tw-text-muted"}`}>
              {label}
            </span>
            {helpText && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="tw-size-4 tw-text-muted" />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="tw-max-w-[300px]">{helpText}</div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className={`tw-flex tw-items-center ${optional ? "tw-gap-3" : "tw-gap-0"}`}>
            {optional && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost2"
                    size="sm"
                    onClick={handleToggleEnabled}
                    className={`tw-size-8 tw-p-0 ${isEnabled ? "tw-text-accent/80 hover:tw-text-accent" : "tw-text-muted hover:tw-text-normal"}`}
                  >
                    {isEnabled ? <Zap className="tw-size-4" /> : <ZapOff className="tw-size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span>{isEnabled ? "Disable parameters" : "Enable parameters"}</span>
                </TooltipContent>
              </Tooltip>
            )}
            <span
              className={`tw-min-w-8 tw-text-right tw-font-mono tw-text-sm ${isEnabled ? "tw-text-normal" : "tw-text-muted"}`}
            >
              {isEnabled ? (value ?? defaultValue) : "—"}
            </span>
          </div>
        </div>
      </TooltipProvider>

      <div className="tw-relative">
        <Slider
          value={[isEnabled ? (value ?? defaultValue) : min]}
          onValueChange={handleValueChange}
          min={min}
          max={max}
          step={step}
          disabled={!isEnabled}
          className={`tw-w-full ${!isEnabled ? "tw-opacity-40" : ""}`}
        />
        {!isEnabled && optional && (
          <div className="tw-absolute tw-inset-0 tw-cursor-not-allowed tw-rounded" />
        )}
      </div>
    </div>
  );
}
