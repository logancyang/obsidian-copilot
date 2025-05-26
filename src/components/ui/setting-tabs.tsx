import React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  icon: React.ReactNode;
  label: string;
  id: string;
}

interface TabItemProps {
  tab: TabItem;
  isSelected: boolean;
  onClick: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export const TabItem: React.FC<TabItemProps> = ({ tab, isSelected, onClick, isFirst, isLast }) => {
  return (
    <div
      role="tab"
      id={`tab-${tab.id}`}
      aria-controls={`tabpanel-${tab.id}`}
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        "tw-flex tw-flex-row tw-items-center",
        "tw-h-8",
        "tw-px-2 tw-py-1",
        "tw-gap-1.5",
        "tw-cursor-pointer",
        "tw-overflow-hidden",
        "tw-whitespace-nowrap",
        "tw-text-sm",
        "tw-border tw-border-border tw-border-solid",
        "tw-rounded-t-md tw-rounded-b-[2px]",
        "tw-bg-primary",
        "tw-transition-all tw-duration-300 tw-ease-in-out",
        "hover:tw-border-interactive-accent hover:tw-border-b-0",
        isSelected && [
          "!tw-bg-interactive-accent",
          "tw-text-on-accent",
          "!tw-px-3",
          "!tw-max-w-full",
          "tw-border-b-0",
          "tw-transition-all tw-duration-300 tw-ease-in-out",
          "tw-delay-200",
        ],
        "lg:tw-max-w-32",
        "md:tw-max-w-32"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-center",
          "tw-w-4 tw-h-4",
          "tw-transition-transform tw-duration-200 tw-ease-in-out",
          isSelected
            ? "tw-opacity-100 tw-max-w-[16px] tw-translate-x-0"
            : "tw-opacity-0 tw-max-w-0 tw--translate-x-4"
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
          "tw-opacity-100 tw-max-w-[100px] tw-translate-x-0"
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
}

export const TabContent: React.FC<TabContentProps> = ({ id, children, isSelected }) => {
  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      className={cn(
        "tw-pt-4",
        "tw-transition-all tw-duration-200 tw-ease-in-out",
        isSelected ? "tw-opacity-100 tw-translate-y-0" : "tw-opacity-0 tw-translate-y-2"
      )}
    >
      {children}
    </div>
  );
};
