/**
 * ModeSelector - Dropdown for selecting Quick Ask mode.
 * Uses DropdownMenu for consistent styling with ModelSelector.
 */

import React from "react";
import { MessageCircle, Pencil, Zap, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QuickAskMode, QuickAskModeConfig } from "./types";

interface ModeSelectorProps {
  modes: QuickAskModeConfig[];
  value: QuickAskMode;
  onChange: (mode: QuickAskMode) => void;
  disabled?: boolean;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  "message-circle": MessageCircle,
  pencil: Pencil,
  zap: Zap,
};

/**
 * ModeSelector component for Quick Ask panel.
 */
export function ModeSelector({ modes, value, onChange, disabled }: ModeSelectorProps) {
  const currentMode = modes.find((m) => m.id === value);
  const IconComponent = iconMap[currentMode?.icon ?? ""] ?? MessageCircle;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="tw-min-w-0 tw-gap-1 tw-px-1.5 tw-text-muted"
        >
          <IconComponent className="tw-size-3.5" />
          <span className="tw-text-xs">{currentMode?.label ?? "Ask"}</span>
          {!disabled && <ChevronDown className="tw-size-3.5" />}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {modes.map((mode) => {
          const ModeIcon = iconMap[mode.icon] ?? MessageCircle;
          return (
            <DropdownMenuItem
              key={mode.id}
              onSelect={() => onChange(mode.id)}
              disabled={!mode.implemented}
              className="tw-gap-2"
            >
              <ModeIcon className="tw-size-4" />
              <div className="tw-flex tw-flex-col">
                <span>{mode.label}</span>
                {!mode.implemented && (
                  <span className="tw-text-xs tw-text-muted">Coming soon</span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
