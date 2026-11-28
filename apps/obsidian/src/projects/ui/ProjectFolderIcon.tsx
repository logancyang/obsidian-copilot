import { cn } from "@/lib/utils";
import { Folder } from "lucide-react";
import React from "react";

interface ProjectFolderIconProps {
  className?: string;
}

export function ProjectFolderIcon({ className }: ProjectFolderIconProps): React.ReactElement {
  return (
    <Folder aria-hidden="true" className={cn("tw-size-4 tw-shrink-0 tw-text-muted", className)} />
  );
}
