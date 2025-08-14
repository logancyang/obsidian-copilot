import React, { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HelpCircle, Zap, ZapOff } from "lucide-react";

interface BaseParameterControlProps {
  label: string;
  helpText?: React.ReactNode;
  disableFn?: () => void;
  optional?: boolean;
}

interface SliderParameterControlProps extends BaseParameterControlProps {
  type: "slider";
  value?: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step: number;
  defaultValue?: number;
}

interface SelectParameterControlProps extends BaseParameterControlProps {
  type: "select";
  value?: string;
  onChange: (value: string) => void;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}

type ParameterControlProps = SliderParameterControlProps | SelectParameterControlProps;

export function ParameterControl(props: ParameterControlProps) {
  const { label, helpText, disableFn, optional = true } = props;
  const type = props.type;

  const initialEnabled = optional ? props.value !== undefined : true;

  const [isEnabled, setIsEnabled] = useState(initialEnabled);

  const handleToggleEnabled = () => {
    if (!optional) return; // Disable switching function in mandatory mode.

    setIsEnabled(!isEnabled);
    if (!isEnabled) {
      // When enabling, set to current value or default
      if (type === "slider") {
        props.onChange(props.value ?? props.defaultValue ?? 0);
      } else {
        props.onChange(props.value ?? props.defaultValue ?? props.options[0]?.value ?? "");
      }
    } else {
      disableFn?.();
    }
  };

  const handleSliderChange = (newValue: number[]) => {
    if (isEnabled && type === "slider") {
      props.onChange(newValue[0]);
    }
  };

  const handleSelectChange = (newValue: string) => {
    if (isEnabled && type === "select") {
      props.onChange(newValue);
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
            <span
              className={`tw-min-w-8 tw-text-right tw-font-mono tw-text-sm ${isEnabled ? "tw-text-normal" : "tw-text-muted"}`}
            >
              {isEnabled ? (props.value ?? props.defaultValue) : "—"}
            </span>
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
          </div>
        </div>
      </TooltipProvider>

      <div className="tw-relative">
        {type === "slider" ? (
          <>
            <Slider
              value={[isEnabled ? (props.value ?? props.defaultValue ?? 0) : (props.min ?? 0)]}
              onValueChange={handleSliderChange}
              min={props.min ?? 0}
              max={props.max ?? 1}
              step={props.step}
              disabled={!isEnabled}
              className={`tw-w-full ${!isEnabled ? "tw-opacity-40" : ""}`}
            />
            {!isEnabled && optional && (
              <div className="tw-absolute tw-inset-0 tw-cursor-not-allowed tw-rounded" />
            )}
          </>
        ) : (
          <Select
            value={
              isEnabled ? (props.value ?? props.defaultValue ?? props.options[0]?.value) : undefined
            }
            onValueChange={handleSelectChange}
            disabled={!isEnabled}
          >
            <SelectTrigger className={`tw-w-full ${!isEnabled ? "tw-opacity-40" : ""}`}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {props.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
