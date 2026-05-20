import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CopilotMode } from "@/agentMode";
import { cn } from "@/lib/utils";

export interface ModePickerOverride {
  options: { label: string; value: CopilotMode }[];
  value: CopilotMode | null;
  onChange: (value: CopilotMode) => void;
  disabled?: boolean;
}

interface ModePickerProps {
  override: ModePickerOverride;
  className?: string;
}

/**
 * Display copy keyed by canonical `CopilotMode`.
 */
const MODE_DISPLAY: Record<CopilotMode, { label: string; description: string }> = {
  auto: {
    label: "Auto",
    description: "Runs tools and edits files without asking.",
  },
  plan: {
    label: "Plan",
    description: "Drafts a plan and waits for your approval before editing.",
  },
  default: {
    label: "Safe",
    description: "Asks for approval before every edit.",
  },
};

export function ModePicker({ override, className }: ModePickerProps) {
  const { options, value, onChange, disabled } = override;
  const triggerLabel = value ? (MODE_DISPLAY[value]?.label ?? value) : "Mode";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="sm"
          disabled={disabled}
          className={cn(
            "tw-shrink-0 tw-text-muted",
            value === "plan" &&
              "tw-text-blue/70 hover:tw-text-blue/100 focus-visible:tw-text-blue/100",
            value === "auto" &&
              "tw-text-red/70 hover:tw-text-red/100 focus-visible:tw-text-red/100",
            className
          )}
          title="Operational mode"
        >
          <span className="tw-truncate">{triggerLabel}</span>
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-4 tw-shrink-0" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="tw-w-[320px]">
        {options.map((opt) => {
          const display = MODE_DISPLAY[opt.value];
          const isActive = value === opt.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => onChange(opt.value)}
              className="tw-items-start tw-gap-2 tw-py-2"
            >
              <div className="tw-mt-0.5 tw-w-3 tw-shrink-0">
                {isActive && <Check className="tw-size-3 tw-text-muted" />}
              </div>
              <div className="tw-flex tw-flex-col tw-gap-0.5">
                <span className="tw-text-sm tw-font-medium tw-text-normal">
                  {display?.label ?? opt.label}
                </span>
                {display?.description && (
                  <span className="tw-text-xs tw-leading-snug tw-text-muted">
                    {display.description}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
