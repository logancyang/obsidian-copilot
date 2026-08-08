import React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  icon: React.ReactNode;
  label: string;
  id: string;
}

/**
 * Which level of the settings pane a strip belongs to. The design gives the two
 * levels different shapes on purpose: `page` tabs sit on the pane's edge, so
 * they are rounded at the top only and their panel paints the grey content
 * backdrop; `inline` tabs are chips nested inside a tab's content, uniformly
 * rounded, and their panel adds no backdrop of its own (the enclosing page
 * panel already supplies one — a second layer would just flatten the cards).
 */
export type TabVariant = "page" | "inline";

interface TabItemProps {
  tab: TabItem;
  isSelected: boolean;
  onClick: () => void;
  isFirst: boolean;
  isLast: boolean;
  variant?: TabVariant;
}

export const TabItem: React.FC<TabItemProps> = ({
  tab,
  isSelected,
  onClick,
  isFirst,
  isLast,
  variant = "page",
}) => {
  return (
    <div
      role="tab"
      id={`tab-${tab.id}`}
      aria-controls={`tabpanel-${tab.id}`}
      aria-selected={isSelected}
      tabIndex={0}
      onClick={onClick}
      // Reason: a `role="tab"` div is not focusable or keyboard-operable on its
      // own. We add tabIndex + Enter/Space activation for a11y, but deliberately
      // skip arrow-key roving — mirrors the locked decision in AgentHomeShelf.tsx
      // (don't reimplement roving tablist navigation here).
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "tw-flex tw-flex-row tw-items-center",
        "tw-h-8",
        "tw-px-2 tw-py-1",
        "tw-gap-1.5",
        "tw-cursor-pointer",
        "tw-overflow-hidden",
        "tw-whitespace-nowrap",
        "tw-text-sm",
        "tw-border tw-border-solid tw-border-border",
        variant === "page" ? "tw-rounded-b-[2px] tw-rounded-t-sm" : "tw-rounded-md",
        "tw-bg-primary",
        "tw-transition-all tw-duration-300 tw-ease-in-out",
        "hover:tw-border-interactive-accent",
        "focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
        isSelected && [
          "!tw-bg-interactive-accent",
          "tw-text-on-accent",
          "!tw-max-w-full",
          "tw-transition-all tw-duration-300 tw-ease-in-out",
          "tw-delay-100",
        ],
        // Inline chips only. A page tab keeps its neutral border when selected:
        // it sits against the pane edge, where an accent outline would read as a
        // second boundary rather than as selection.
        isSelected && variant === "inline" && "!tw-border-interactive-accent",
        "lg:tw-max-w-32",
        "md:tw-max-w-32"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-center",
          "tw-size-4",
          "tw-transition-transform tw-duration-200 tw-ease-in-out",
          isSelected
            ? "tw-max-w-[16px] tw-translate-x-0 tw-opacity-100"
            : "tw-max-w-0 tw--translate-x-4 tw-opacity-0"
        )}
      >
        {tab.icon}
      </div>
      <span
        className={cn(
          "tw-text-sm",
          "tw-font-medium",
          "tw-transition-all tw-duration-200 tw-ease-in-out",
          "tw-overflow-hidden tw-whitespace-nowrap",
          "tw-max-w-[100px] tw-translate-x-0 tw-opacity-100"
        )}
      >
        {tab.label}
      </span>
    </div>
  );
};

interface TabContentProps {
  id: string;
  children: React.ReactNode;
  isSelected: boolean;
  variant?: TabVariant;
}

export const TabContent: React.FC<TabContentProps> = ({
  id,
  children,
  isSelected,
  variant = "page",
}) => {
  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      className={cn(
        // Grey backdrop so the white section cards visually separate (design:
        // grey content area + white cards). Without it the cards blend into the
        // modal background and only their borders show, reading as boxed rows.
        variant === "page" ? "tw-mt-4 tw-rounded-lg tw-bg-secondary tw-p-4" : "tw-mt-3",
        "tw-transition-all tw-duration-200 tw-ease-in-out",
        isSelected ? "tw-translate-y-0 tw-opacity-100" : "tw-translate-y-2 tw-opacity-0"
      )}
    >
      {children}
    </div>
  );
};
