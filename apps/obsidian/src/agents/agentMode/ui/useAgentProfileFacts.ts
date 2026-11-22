import { listAgentChats } from "@/agents/agentMode/agentChats";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { readMemoryRules } from "@/agents/memorySaves";
import type { AgentMemoryFacts, AgentProfileFacts } from "@/agents/ui/AgentProfileView";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { logWarn } from "@/logger";
import { TFile, type App, type TAbstractFile } from "obsidian";
import { useEffect, useState } from "react";

type ProfileFactsAgent = Pick<CustomAgent, "slug" | "instructionsPath" | "memoryPath">;

export function useAgentProfileFacts(
  app: App,
  manager: AgentSessionManager,
  agent: ProfileFactsAgent
): AgentProfileFacts {
  const { slug, instructionsPath, memoryPath } = agent;
  const [chatCount, setChatCount] = useState<number | null>(null);
  const [memory, setMemory] = useState<AgentMemoryFacts | null>(null);

  useEffect(() => {
    let mounted = true;
    listAgentChats(manager, slug).then(
      (chats) => mounted && setChatCount(chats.length),
      (error: unknown) => logWarn(`[Custom agents] Could not count ${slug}'s chats`, error)
    );
    return () => {
      mounted = false;
    };
  }, [manager, slug]);

  useEffect(() => {
    const { vault } = app;
    let latestRead = 0;
    const read = async () => {
      const readId = ++latestRead;
      const file = vault.getAbstractFileByPath(memoryPath);
      const next =
        file instanceof TFile
          ? { rules: readMemoryRules(await vault.read(file)).length, changedAt: file.stat.mtime }
          : null;
      if (readId === latestRead) setMemory(next);
    };
    const refresh = () =>
      void read().catch((error: unknown) =>
        logWarn(`[Custom agents] Could not read ${memoryPath}`, error)
      );
    const onChange = (file: TAbstractFile, oldPath?: string) => {
      if (file.path === memoryPath || oldPath === memoryPath) refresh();
    };
    refresh();
    const refs = [
      vault.on("create", onChange),
      vault.on("modify", onChange),
      vault.on("delete", onChange),
      vault.on("rename", onChange),
    ];
    return () => {
      latestRead = -1;
      refs.forEach((ref) => vault.offref(ref));
    };
  }, [app, memoryPath]);

  const instructions = app.vault.getAbstractFileByPath(instructionsPath);
  const stat = instructions instanceof TFile ? instructions.stat : null;
  return { chatCount, createdAt: stat?.ctime ?? null, editedAt: stat?.mtime ?? null, memory };
}
