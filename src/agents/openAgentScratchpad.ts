import { openVaultPath } from "@/utils/openVaultPath";
import { App, Notice } from "obsidian";

export function openAgentScratchpad(
  app: App,
  scratchpadPath: string,
  agentName: string,
  open: (path: string) => void = (path) => openVaultPath(app, path, { newLeaf: true })
): void {
  if (!app.vault.getAbstractFileByPath(scratchpadPath)) {
    new Notice(`${agentName} hasn't started a scratchpad yet.`);
    return;
  }
  open(scratchpadPath);
}
