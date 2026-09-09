import { cn } from "@/lib/utils";
import React from "react";

interface AgentIconButtonProps {
  /**
   * Brand glyph for this agent. Sourced from the backend descriptor
   * (`BackendDescriptor.Icon`) and threaded down through the host so the
   * skills layer never names specific agents.
   */
  Icon: React.ComponentType<{ className?: string }>;
  /** Backend id — used to derive the default aria-label. */
  agentId: string;
  /** Backend display name — preferred for the title tooltip when none is provided. */
  agentName?: string;
  /** Toggled-on state — filled brand colour vs. dashed outline. */
  enabled: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  size?: "sm" | "md";
}

/** Brand-coloured agent toggle button. */
export const AgentIconButton: React.FC<AgentIconButtonProps> = ({
  Icon,
  agentId,
  agentName,
  enabled,
  disabled = false,
  onClick,
  title,
  size = "md",
}) => {
  const label = agentName ?? agentId;
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        // Unavailable agents must not be activated through keyboard input.
        // https://github.com/logancyang/obsidian-copilot/issues/3022
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      title={title}
      aria-pressed={enabled}
      aria-label={title ?? `${enabled ? "Disable" : "Enable"} ${label}`}
      className={cn(
        "tw-flex tw-items-center tw-justify-center tw-transition-transform",
        disabled ? "tw-cursor-not-allowed tw-opacity-40" : "hover:tw--translate-y-px",
        size === "md" ? "tw-size-[26px] tw-rounded-[7px]" : "tw-size-5 tw-rounded-[5px]",
        enabled
          ? "tw-bg-interactive-accent tw-text-on-accent"
          : "tw-border tw-border-dashed tw-border-[var(--text-faint)] tw-bg-primary tw-text-faint tw-opacity-60 hover:tw-opacity-100"
      )}
    >
      <Icon className="tw-size-3.5" />
    </div>
  );
};
