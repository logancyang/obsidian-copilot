import React from "react";
import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import { miyoSearchRun } from "@/miyo/agentMode/miyoSearchRun";
import { MiyoSearchCard } from "@/miyo/agentMode/ui/MiyoSearchCard";
import { openVaultPath } from "@/utils/openVaultPath";

export const miyoCardKind: ToolCardKind = {
  // A grouped Miyo search would be hidden behind "Ran N commands".
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/718
  place: (part) => (miyoSearchRun(part) ? { joinKey: null } : null),
  render: ([search], { app, open, onToggle }) => {
    const run = miyoSearchRun(search);
    return run ? (
      <MiyoSearchCard
        {...run}
        open={open}
        onToggle={onToggle}
        onOpenNote={(path) => openVaultPath(app, path, { newLeaf: true })}
      />
    ) : null;
  },
};
