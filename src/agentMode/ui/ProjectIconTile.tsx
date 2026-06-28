import { cn } from "@/lib/utils";
import { Folder } from "lucide-react";
import React, { memo } from "react";

// Stable per-project accent: hash the id into one of six theme hues so a project
// keeps the same color across renders and sessions (Math.random would reshuffle
// every paint). Each entry pairs a solid `text` hue with its soft `bg` tint from
// the `project` palette in tailwind.config — the folder glyph inherits the text
// color, the tile shows the tint behind it.
const PROJECT_ICON_PALETTE = [
  "tw-text-project-red tw-bg-project-red",
  "tw-text-project-orange tw-bg-project-orange",
  "tw-text-project-yellow tw-bg-project-yellow",
  "tw-text-project-green tw-bg-project-green",
  "tw-text-project-blue tw-bg-project-blue",
  "tw-text-project-purple tw-bg-project-purple",
] as const;

function projectIconClasses(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // clamp to 32-bit so long ids stay deterministic
  }
  return PROJECT_ICON_PALETTE[Math.abs(hash) % PROJECT_ICON_PALETTE.length];
}

interface ProjectIconTileProps {
  /** Project id — the sole color input, so the accent survives renames. */
  id: string;
}

/**
 * Tinted square + colored folder, stable per project id. The project's visual
 * identity primitive, shared by every surface that represents a project (the
 * Projects-tab rows, the in-project workspace header) so one project always
 * carries one color. Decorative: the adjacent project name is the readable text.
 */
export const ProjectIconTile = memo(
  ({ id }: ProjectIconTileProps): React.ReactElement => (
    <span
      aria-hidden="true"
      className={cn(
        "tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md",
        projectIconClasses(id)
      )}
    >
      <Folder className="tw-size-4" />
    </span>
  )
);
ProjectIconTile.displayName = "ProjectIconTile";
