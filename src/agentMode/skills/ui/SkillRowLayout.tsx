import { cn } from "@/lib/utils";
import React from "react";

export interface SkillRowLayoutProps {
  name: string;
  description: string;
  annotations?: React.ReactNode;
  controls: React.ReactNode;
  actions: React.ReactNode;
  menuOpen?: boolean;
}

/** Shared compact row chrome for user-owned and bundled skills. */
export function SkillRowLayout({
  name,
  description,
  annotations,
  controls,
  actions,
  menuOpen,
}: SkillRowLayoutProps) {
  return (
    <div
      data-menu-open={menuOpen ? "true" : undefined}
      className={cn(
        "tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-2",
        "tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary",
        "tw-px-3.5 tw-py-2.5",
        "tw-transition-colors hover:tw-border-border-hover hover:tw-bg-primary-alt",
        "data-[menu-open=true]:tw-bg-primary-alt data-[menu-open=true]:tw-border-normal/100"
      )}
    >
      {/* Keep names and annotations readable before wrapping controls below them.
          https://github.com/logancyang/obsidian-copilot/issues/3022 */}
      <div className="tw-min-w-0 tw-max-w-full tw-flex-1 tw-basis-48 tw-@container/skill-title">
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          <span
            title={name}
            className="tw-max-w-full tw-truncate tw-text-ui-small tw-font-semibold tw-text-normal"
          >
            {name}
          </span>
          {annotations}
        </div>
        {description.length > 0 && (
          <div
            title={description}
            className="tw-mt-0.5 tw-max-w-[540px] tw-truncate tw-text-ui-smaller tw-text-muted"
          >
            {description}
          </div>
        )}
      </div>
      {controls}
      {actions}
    </div>
  );
}
