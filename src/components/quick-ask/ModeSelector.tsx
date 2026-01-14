/**
 * ModeSelector - Dropdown for selecting Quick Ask mode.
 */

import React from "react";
import { MessageCircle, Pencil, Zap } from "lucide-react";
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
  // Avoid runtime crash if a mode registers an unknown icon key
  const IconComponent = iconMap[currentMode?.icon ?? ""] ?? MessageCircle;

  return (
    <div className="tw-relative tw-inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as QuickAskMode)}
        disabled={disabled}
        className="tw-appearance-none tw-rounded tw-border tw-border-solid tw-border-border tw-bg-primary tw-py-1 tw-pl-7 tw-pr-6 tw-text-xs tw-text-normal hover:tw-bg-modifier-hover focus:tw-outline-none disabled:tw-opacity-50"
        title={currentMode?.description}
      >
        {modes.map((mode) => (
          <option key={mode.id} value={mode.id} disabled={!mode.implemented}>
            {mode.label}
            {!mode.implemented ? " (Coming soon)" : ""}
          </option>
        ))}
      </select>
      <div className="tw-pointer-events-none tw-absolute tw-left-2 tw-top-1/2 tw--translate-y-1/2">
        <IconComponent className="tw-size-3 tw-text-muted" />
      </div>
    </div>
  );
}
