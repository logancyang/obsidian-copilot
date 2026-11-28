import { cn } from "@/lib/utils";
import * as React from "react";

export interface SegmentedControlOption<T extends string> {
  label: React.ReactNode;
  value: T;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const buttonRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const enabledIndices = options
    .map((option, index) => (option.disabled || disabled ? -1 : index))
    .filter((index) => index !== -1);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStopIndex =
    selectedIndex !== -1 && enabledIndices.includes(selectedIndex)
      ? selectedIndex
      : (enabledIndices[0] ?? -1);

  const focusAdjacent = (currentIndex: number, direction: 1 | -1) => {
    if (enabledIndices.length === 0) return;
    const position = enabledIndices.indexOf(currentIndex);
    const nextPosition = (position + direction + enabledIndices.length) % enabledIndices.length;
    const nextIndex = enabledIndices[nextPosition];
    buttonRefs.current[nextIndex]?.focus();
    onChange(options[nextIndex].value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusAdjacent(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusAdjacent(index, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "tw-inline-flex tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-text-ui-smaller tw-font-medium",
        className
      )}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isDisabled = disabled || option.disabled;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={isDisabled}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onClick={() => !isDisabled && onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "tw-cursor-pointer !tw-rounded-none tw-border-none !tw-px-3 !tw-py-1.5 !tw-shadow-none tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
              index > 0 && "tw-border-l tw-border-solid tw-border-border",
              isSelected
                ? "!tw-bg-interactive-accent !tw-text-on-accent"
                : "!tw-bg-secondary tw-text-muted hover:!tw-bg-modifier-hover hover:tw-text-normal",
              isDisabled && "tw-cursor-not-allowed tw-opacity-50"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
