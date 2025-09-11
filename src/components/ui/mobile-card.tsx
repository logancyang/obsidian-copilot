import React, { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, GripVertical, MoreVertical } from "lucide-react";

export interface MobileCardDropdownAction<T = any> {
  icon: React.ReactNode;
  label: string;
  onClick: (item: T) => void;
  variant?: "default" | "destructive";
}

export interface MobileCardProps<T = any> {
  id: string;
  item: T;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  isDraggable?: boolean;
  isExpandable?: boolean;
  defaultExpanded?: boolean;
  expandedContent?: React.ReactNode;
  primaryAction?: {
    icon: React.ReactNode;
    onClick: (item: T) => void;
    tooltip?: string;
  };
  dropdownActions?: Array<MobileCardDropdownAction<T>>;
  containerRef?: React.RefObject<HTMLDivElement>;
  className?: string;
  onExpandToggle?: (expanded: boolean) => void;
}

export function MobileCard<T = any>({
  id,
  item,
  title,
  subtitle,
  badge,
  icon,
  isDraggable = false,
  isExpandable = false,
  defaultExpanded = false,
  expandedContent,
  primaryAction,
  dropdownActions = [],
  containerRef,
  className,
  onExpandToggle,
}: MobileCardProps<T>) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleExpandToggle = () => {
    if (isExpandable) {
      const newExpanded = !isExpanded;
      setIsExpanded(newExpanded);
      onExpandToggle?.(newExpanded);
    }
  };

  const showDropdownMenu = dropdownActions.length > 0;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "tw-mb-2",
        isDragging && [
          "tw-opacity-90",
          "tw-shadow-lg",
          "tw-border-accent/50",
          "tw-relative",
          "tw-z-[9999]",
          "tw-bg-primary",
          "tw-rounded-lg",
          "tw-transform-gpu",
        ],
        isDraggable && "tw-touch-manipulation",
        className
      )}
    >
      <CardHeader className="tw-p-3">
        <div className="tw-flex tw-items-center tw-justify-between">
          {/* Drag handle */}
          {isDraggable && (
            <div
              className="tw-mr-2 tw-cursor-grab tw-touch-none active:tw-cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="tw-size-4" />
            </div>
          )}

          {/* Main content area */}
          <div
            className="tw-flex-1 tw-touch-auto"
            onClick={isExpandable ? handleExpandToggle : undefined}
            style={{ cursor: isExpandable ? "pointer" : "default" }}
          >
            <div className="tw-flex tw-items-center tw-gap-2">
              {/* Expand/collapse icon */}
              {isExpandable && (
                <div className="tw-flex tw-size-3 tw-items-center tw-justify-center">
                  {isExpanded ? (
                    <ChevronDown className="tw-size-3 tw-stroke-[7]" />
                  ) : (
                    <ChevronRight className="tw-size-3 tw-stroke-[7]" />
                  )}
                </div>
              )}

              {/* Custom icon */}
              {icon && <div className="tw-flex tw-items-center tw-justify-center">{icon}</div>}

              {/* Title and subtitle area */}
              <div className="tw-min-w-0 tw-flex-1">
                <div className="tw-break-words tw-font-medium tw-leading-relaxed">
                  {title}
                  {badge && <span className="tw-ml-1 tw-inline-flex tw-items-center">{badge}</span>}
                </div>
                {subtitle && (
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <span className="tw-bg-secondary tw-text-sm tw-text-muted">{subtitle}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="tw-flex tw-items-center tw-gap-2">
            {primaryAction && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  primaryAction.onClick(item);
                }}
                title={primaryAction.tooltip}
              >
                {primaryAction.icon}
              </Button>
            )}

            {showDropdownMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="tw-size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" container={containerRef?.current}>
                  {dropdownActions.map((action, index) => (
                    <DropdownMenuItem
                      key={index}
                      onClick={(e) => {
                        e.stopPropagation();
                        action.onClick(item);
                      }}
                      className={cn(action.variant === "destructive" && "tw-text-error")}
                    >
                      <span className="tw-mr-2 tw-flex tw-size-4 tw-items-center tw-justify-center">
                        {action.icon}
                      </span>
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Expandable content */}
      {isExpandable && (
        <div
          className={cn(
            "tw-transition-all tw-duration-300 tw-ease-in-out",
            isExpanded ? "tw-max-h-96 tw-opacity-100" : "tw-max-h-0 tw-overflow-hidden tw-opacity-0"
          )}
        >
          <CardContent className="tw-p-3 tw-pt-0">{expandedContent}</CardContent>
        </div>
      )}
    </Card>
  );
}
