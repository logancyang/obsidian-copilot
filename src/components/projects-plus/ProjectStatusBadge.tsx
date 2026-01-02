import { ProjectStatus } from "@/types/projects-plus";
import { cn } from "@/lib/utils";
import { getStatusBadgeStyles } from "./utils";
import * as React from "react";

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
}

/**
 * Reusable status badge component for projects
 */
export function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
  return (
    <span
      className={cn(
        "tw-rounded-sm tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-capitalize",
        getStatusBadgeStyles(status),
        className
      )}
    >
      {status}
    </span>
  );
}
