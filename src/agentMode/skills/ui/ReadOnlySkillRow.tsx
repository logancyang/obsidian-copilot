import { SkillRowLayout } from "./SkillRowLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { AgentBrand } from "@/agentMode/session/types";
import type { ReadOnlySkill } from "@/agentMode/skills/types";
import { FileText, FolderSearch, MoreVertical } from "lucide-react";
import React from "react";

interface ReadOnlySkillRowProps {
  skill: ReadOnlySkill;
  agents: ReadonlyArray<AgentBrand>;
  locationLabel: string;
  revealLabel: string;
  onOpenSkillMd: () => void;
  onReveal: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

export const ReadOnlySkillRow: React.FC<ReadOnlySkillRowProps> = ({
  skill,
  agents,
  locationLabel,
  revealLabel,
  onOpenSkillMd,
  onReveal,
  containerRef,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const loadedBy = agents.filter((agent) => skill.agents.includes(agent.id));
  const loadedByNames = loadedBy.map((agent) => agent.displayName).join(", ");

  return (
    <SkillRowLayout
      name={skill.name}
      description={skill.description}
      menuOpen={menuOpen}
      annotations={
        <span title={locationLabel} className="tw-truncate tw-text-ui-smaller tw-text-faint">
          in {locationLabel}
        </span>
      }
      controls={
        <div
          className="tw-flex tw-items-center tw-gap-1.5 tw-text-muted"
          role="img"
          aria-label={`Used by ${loadedByNames}`}
          title={`Used by ${loadedByNames}`}
        >
          {loadedBy.map((agent) => (
            <agent.Icon key={agent.id} className="tw-size-3.5" />
          ))}
        </div>
      }
      actions={
        // Non-modal: a modal menu can strand Radix's wheel listener after Reveal in vault.
        // https://github.com/logancyang/obsidian-copilot-preview/issues/118
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title="More actions"
              aria-label={`More actions for ${skill.name}`}
            >
              <MoreVertical className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="tw-min-w-[180px]"
            container={containerRef.current}
          >
            <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onOpenSkillMd}>
              <FileText className="tw-size-3.5" aria-hidden="true" />
              Open SKILL.md
            </DropdownMenuItem>
            <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onReveal}>
              <FolderSearch className="tw-size-3.5" aria-hidden="true" />
              {revealLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
};
