import type { AgentChatMessage } from "@/agentMode/session/types";
import type { ToolCardKind } from "@/agentMode/ui/activityGroups";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";
import { SAVE_MEMORY_TOOL_NAME } from "@/agents/agentMode/saveMemoryTool";
import { MemorySaveLine } from "@/agents/agentMode/ui/MemorySaveLine";
import { INSTRUCTIONS_FILE_NAME } from "@/agents/customAgentFiles";
import { readMemoryRules, sameRule, type MemorySave } from "@/agents/memorySaves";
import { logError } from "@/logger";
import { openVaultPath } from "@/utils/openVaultPath";
import { TFile, type App } from "obsidian";
import React from "react";

export interface MemorySaveTrail {
  saves: readonly MemorySave[];
  byCall: ReadonlyMap<string, readonly MemorySave[]>;
  unplaced: readonly MemorySave[];
}

function savedRule(part: ToolCallPart): string | null {
  const call = copilotToolCall(part, SAVE_MEMORY_TOOL_NAME);
  if (!call) return null;
  const rule = "code" in call ? codeStringField(call.code, "rule") : call.args.rule;
  return typeof rule === "string" ? sameRule(rule) : null;
}

export function memorySaveTrail(message: AgentChatMessage): MemorySaveTrail | null {
  const saves = message.memorySaves;
  if (!saves?.length) return null;
  const calls = (message.parts ?? []).filter(
    (part): part is ToolCallPart => part.kind === "tool_call"
  );
  const byCall = new Map<string, MemorySave[]>();
  const unplaced: MemorySave[] = [];
  for (const save of saves) {
    // A save takes the place of the save_memory call that made it, the last one with its rule after a turned-down try.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
    const call = calls.filter((part) => savedRule(part) === sameRule(save.rule)).pop();
    if (call) byCall.set(call.id, [...(byCall.get(call.id) ?? []), save]);
    else unplaced.push(save);
  }
  return { saves, byCall, unplaced };
}

export async function openAgentFile(
  app: App,
  path: string,
  eState?: Record<string, unknown>
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  const openLeaf = app.workspace
    .getLeavesOfType("markdown")
    .find((leaf) => (leaf.getViewState().state as { file?: unknown })?.file === path);
  const leaf = openLeaf ?? app.workspace.getLeaf("tab");
  await leaf.openFile(file, { active: true, eState });
}

export async function openMemoryRule(app: App, memoryPath: string, rule: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(memoryPath);
  if (!(file instanceof TFile)) return;
  const line = readMemoryRules(await app.vault.cachedRead(file)).find(
    (candidate) => candidate.rule === rule
  )?.line;
  await openAgentFile(
    app,
    memoryPath,
    line === undefined
      ? undefined
      : { scroll: line, cursor: { from: { line, ch: 0 }, to: { line, ch: rule.length } } }
  );
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

// A save replaces the generic card of the call that made it, so it reads in the turn's order.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/942
export const memorySaveCardKind: ToolCardKind = {
  place: (part, { memorySaves }) => (memorySaves?.byCall.has(part.id) ? { joinKey: null } : null),
  render: ([part], { app, memorySaves }) => {
    const saves = memorySaves?.byCall.get(part.id);
    return saves ? <MemorySaveLines saves={saves} app={app} /> : null;
  },
};
