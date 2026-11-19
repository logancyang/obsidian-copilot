import { diffTargetPaths, editTargetPaths } from "@/agentMode/session/editTargets";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import { MemorySaveLine } from "@/agents/agentMode/ui/MemorySaveLine";
import { INSTRUCTIONS_FILE_NAME } from "@/agents/customAgentFiles";
import { readMemoryRules, type MemorySave } from "@/agents/memorySaves";
import { logError } from "@/logger";
import { openVaultPath } from "@/utils/openVaultPath";
import { TFile, type App } from "obsidian";
import React from "react";

export interface MemorySaveTrail {
  saves: readonly MemorySave[];
  anchorId: string | null;
}

export function memorySaveTrail(
  message: AgentChatMessage,
  vaultBase: string | null
): MemorySaveTrail | null {
  const saves = message.memorySaves;
  if (!saves?.length) return null;
  const memoryPath = saves[0].memoryPath;
  // One Codex or OpenCode patch can edit MEMORY.md and a note together; that edit keeps its card so the note's edit stays in view.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/942
  const anchor = message.parts?.find((part) => {
    if (part.kind !== "tool_call" || part.toolKind !== "edit") return false;
    const targets = editTargetPaths(
      { locations: part.locations, input: part.input, diffPaths: diffTargetPaths(part.output) },
      vaultBase
    );
    return targets.length > 0 && targets.every((target) => target === memoryPath);
  });
  return { saves, anchorId: anchor?.kind === "tool_call" ? anchor.id : null };
}

export async function openMemoryRule(app: App, memoryPath: string, rule: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(memoryPath);
  if (!(file instanceof TFile)) return;
  const line = readMemoryRules(await app.vault.cachedRead(file)).find(
    (candidate) => candidate.rule === rule
  )?.line;
  const openLeaf = app.workspace
    .getLeavesOfType("markdown")
    .find((leaf) => (leaf.getViewState().state as { file?: unknown })?.file === memoryPath);
  const leaf = openLeaf ?? app.workspace.getLeaf("tab");
  await leaf.openFile(file, {
    active: true,
    eState:
      line === undefined
        ? undefined
        : { scroll: line, cursor: { from: { line, ch: 0 }, to: { line, ch: rule.length } } },
  });
}

function instructionsPathOf(memoryPath: string): string {
  return `${memoryPath.slice(0, memoryPath.lastIndexOf("/") + 1)}${INSTRUCTIONS_FILE_NAME}`;
}

export const MemorySaveLines: React.FC<{ saves: readonly MemorySave[]; app: App }> = ({
  saves,
  app,
}) => (
  <>
    {saves.map((save) => (
      <MemorySaveLine
        key={save.rule}
        {...save}
        onOpen={() =>
          void openMemoryRule(app, save.memoryPath, save.rule).catch((error: unknown) =>
            logError("[Custom agents] failed to open a saved rule", error)
          )
        }
        onOpenInstruction={() => openVaultPath(app, instructionsPathOf(save.memoryPath))}
      />
    ))}
  </>
);

// A save replaces the generic edit card where the agent wrote its memory, so it reads in the turn's order.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/942
export const memorySaveCardKind: ToolCardKind = {
  place: (part, { memorySaves }) => (memorySaves?.anchorId === part.id ? { joinKey: null } : null),
  render: (_members, { app, memorySaves }) =>
    memorySaves ? <MemorySaveLines saves={memorySaves.saves} app={app} /> : null,
};
