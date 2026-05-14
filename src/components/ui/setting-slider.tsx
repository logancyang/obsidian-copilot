import React, { useState } from "react";
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
  suffix?: string;
}

export function SettingSlider({
  value: initialValue,
  onChange,
  min,
  max,
  step,
  disabled,
  className,
  suffix,
}: SettingSliderProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const displayedValue = dragValue ?? initialValue;

  return (
    <div className={cn("tw-flex tw-items-center tw-gap-4", className)}>
      <Slider
        value={[displayedValue]}
        onValueChange={([value]) => setDragValue(value)}
        onValueCommit={([value]) => {
          setDragValue(null);
          onChange?.(value);
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="tw-flex-1"
      />
      <div className="tw-min-w-[60px] tw-text-right tw-text-sm tw-tabular-nums">
        {displayedValue >= 1000
          ? `${displayedValue % 1000 === 0 ? displayedValue / 1000 : (displayedValue / 1000).toFixed(1)}k`
          : displayedValue}
        {suffix}
      </div>
    </div>
  );
}
