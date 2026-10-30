import React from "react";
import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import { excalidrawToolRun, summarizeDrawing } from "@/excalidraw/agentMode/excalidrawToolRun";
import { ExcalidrawToolCard } from "@/excalidraw/agentMode/ui/ExcalidrawToolCard";
import { openVaultPath } from "@/utils/openVaultPath";

export const excalidrawCardKind: ToolCardKind = {
  place: (part) => {
    const run = excalidrawToolRun(part);
    // One card per drawing between two messages, so an agent's write-render-fix loop reads as one change; a call
    // whose path is unknown may target any drawing, so it never joins a card.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/787
    return run && { joinKey: run.path };
  },
  render: (members, { app, open, onToggle, renderCall }) => (
    <ExcalidrawToolCard
      {...summarizeDrawing(members)}
      onOpenDrawing={(path) => openVaultPath(app, path, { newLeaf: true })}
      open={open}
      onToggle={onToggle}
    >
      {members.map((part) => renderCall(part))}
    </ExcalidrawToolCard>
  ),
};
