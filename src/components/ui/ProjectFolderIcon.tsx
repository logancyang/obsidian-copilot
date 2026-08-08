import { cn } from "@/lib/utils";
import { Folder } from "lucide-react";
import React from "react";

interface ProjectFolderIconProps {
  className?: string;
}

/**
 * Neutral folder marker for project identities. Keeping the treatment here
 * prevents project lists and headers from assigning decorative identity colors.
 */
export function ProjectFolderIcon({ className }: ProjectFolderIconProps): React.ReactElement {
  return (
    <Folder aria-hidden="true" className={cn("tw-size-4 tw-shrink-0 tw-text-muted", className)} />
  );
}
