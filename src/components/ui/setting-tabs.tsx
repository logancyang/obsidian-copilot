import React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  icon: React.ReactNode;
  label: string;
  id: string;
  warningLabel?: string;
}

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
      aria-label={tab.warningLabel ? `${tab.label}: ${tab.warningLabel}` : tab.label}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "tw-relative tw-flex tw-flex-row tw-items-center",
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
      {/* https://github.com/Brevilabs/obsidian-copilot-private/issues/166 The Skills panel is unmounted while inactive, so the tab carries the marker. */}
      {tab.warningLabel && (
        <span
          aria-hidden="true"
          title={tab.warningLabel}
          className="tw-pointer-events-none tw-absolute tw-right-1 tw-top-1 tw-size-1.5 tw-rounded-full tw-bg-warning"
        />
      )}
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
        variant === "page" ? "tw-mt-4 tw-rounded-lg tw-bg-secondary tw-p-4" : "tw-mt-3",
        "tw-transition-all tw-duration-200 tw-ease-in-out",
        isSelected ? "tw-translate-y-0 tw-opacity-100" : "tw-translate-y-2 tw-opacity-0"
      )}
    >
      {children}
    </div>
  );
};
