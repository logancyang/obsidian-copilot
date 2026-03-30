import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

/**
 * Visual step progress indicator with numbered circles and connecting lines.
 * Shows completed (checkmark), active (ring highlight), and upcoming (gray) states.
 */
export const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep, className }) => {
  return (
    <nav aria-label="Progress" className={cn("tw-flex tw-items-center tw-gap-0", className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;
        const isUpcoming = index > currentStep;

        return (
          <div
            key={`${index}-${step.label}`}
            className="tw-flex tw-flex-1 tw-items-center last:tw-flex-none"
          >
            <div className="tw-flex tw-flex-col tw-items-center tw-gap-1.5">
              <div
                className={cn(
                  "tw-flex tw-size-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-text-xs tw-font-semibold tw-transition-all tw-duration-200",
                  isCompleted &&
                    "tw-bg-[rgba(var(--color-green-rgb),0.15)] tw-text-[var(--color-green)]",
                  isActive &&
                    "tw-bg-interactive-accent tw-text-on-accent tw-ring-2 tw-ring-ring tw-ring-offset-2",
                  isUpcoming && "tw-bg-secondary tw-text-muted"
                )}
                aria-current={isActive ? "step" : undefined}
              >
                {isCompleted ? <Check className="tw-size-4" /> : <span>{index + 1}</span>}
              </div>
              <span
                className={cn(
                  "tw-whitespace-nowrap tw-text-xs tw-transition-colors tw-duration-200",
                  isCompleted && "tw-text-[var(--color-green)]",
                  isActive && "tw-font-medium tw-text-normal",
                  isUpcoming && "tw-text-muted"
                )}
              >
                {step.label}
              </span>
            </div>

            {index < steps.length - 1 && (
              <div
                className={cn(
                  "tw-mx-3 tw-mt-[-1.25rem] tw-h-px tw-flex-1 tw-transition-colors tw-duration-200",
                  index < currentStep
                    ? "tw-bg-[var(--color-green)]"
                    : "tw-bg-[var(--background-modifier-border)]"
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
};
