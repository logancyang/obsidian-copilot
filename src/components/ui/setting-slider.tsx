import React from "react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

interface SettingSliderProps {
  value: number;
  onChange?: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  className?: string;
}

export function SettingSlider({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  className,
}: SettingSliderProps) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <Slider
        value={[value]}
        onValueChange={([value]) => onChange?.(value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="flex-1"
      />
      <div className="min-w-[40px] text-sm text-right">{value}</div>
    </div>
  );
}
