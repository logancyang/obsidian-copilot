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
        "flex flex-row items-center",
        "h-8",
        "px-2 py-1",
        "gap-1.5",
        "cursor-pointer",
        "overflow-hidden",
        "whitespace-nowrap",
        "text-sm",
        "border border-border border-solid",
        "rounded-t-lg rounded-b-[2px]",
        "bg-primary",
        "transition-all duration-300 ease-in-out",
        "hover:border-interactive-accent hover:border-b-0",
        isSelected && [
          "!bg-interactive-accent",
          "text-on-accent",
          "!px-3",
          "!max-w-full",
          "border-b-0",
          "transition-all duration-300 ease-in-out",
          "delay-200",
        ],
        "lg:max-w-12",
        "md:max-w-12"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center",
          "w-4 h-4",
          "transition-transform duration-200 ease-in-out"
        )}
      >
        {tab.icon}
      </div>
      <span
        className={cn(
          "text-sm",
          "font-medium",
          "transition-all duration-200 ease-in-out",
          "overflow-hidden whitespace-nowrap",
          isSelected
            ? "opacity-100 max-w-[100px] translate-x-0"
            : "opacity-0 max-w-0 -translate-x-4"
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
        "pt-4",
        "bg-background",
        "transition-all duration-200 ease-in-out",
        isSelected ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}
    >
      {children}
    </div>
  );
};
