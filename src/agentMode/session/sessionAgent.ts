import type { AgentFileManager } from "@/agents/AgentFileManager";
import { formatMissingAgentLabel } from "@/agents/agentDisplay";
import { formatMemoryEntryDate } from "@/agents/agentMemory";
import { hashMemoryContent } from "@/agents/agentMemoryFile";
import { agentMemoryIndexCutoff, buildAgentMemoryIndex } from "@/agents/agentMemoryIndex";
import { BUILTIN_AGENT, type CustomAgent } from "@/agents/types";
import { buildAgentMemoryBlock, buildAgentPersonaBlock } from "@/agentMode/session/promptEnvelope";
import { logWarn } from "@/logger";

export interface SessionAgent {
  slug: string | null;
  name: string;
  icon: string;
  avatarSrc?: string | null;
  personaBlock: string | null;
  memory: AgentMemoryInjection | null;
}

export interface AgentMemoryInjection {
  block: string;
  fingerprint: string;
}

export const COPILOT_SESSION_AGENT: SessionAgent = Object.freeze({
  slug: null,
  name: BUILTIN_AGENT.name,
  icon: BUILTIN_AGENT.icon,
  personaBlock: null,
  memory: null,
});

export async function loadAgentMemoryInjection(
  files: AgentFileManager,
  agent: CustomAgent,
  now: Date = new Date()
): Promise<AgentMemoryInjection | null> {
  if (!agent.memoryEnabled) return null;
  try {
    const core = await files.readMemoryDocument(agent.slug);
    const notes = await files.readDailyNotesAfter(agent.slug, agentMemoryIndexCutoff(now));
    const scratchpad = await files.readScratchpad(agent.slug);
    const modifiedAtMs = Math.max(
      core?.modifiedAtMs ?? 0,
      scratchpad?.modifiedAtMs ?? 0,
      ...notes.map((note) => note.modifiedAtMs)
    );

    const block = buildAgentMemoryBlock(agent.name, {
      core: core?.body ?? null,
      index: buildAgentMemoryIndex(notes),
      scratchpad: scratchpad?.text ?? null,
      modifiedAtMs,
    });
    return block ? { block, fingerprint: hashMemoryContent(block) } : null;
  } catch (error) {
    logWarn(`[Agents] Could not read memory for "${agent.slug}"`, error);
    return null;
  }
}

export async function loadSessionAgent(
  files: AgentFileManager,
  agent: CustomAgent,
  options: { writable?: boolean } = {}
): Promise<SessionAgent> {
  const writable = options.writable !== false;
  const writeTargets =
    writable && agent.memoryEnabled
      ? {
          dailyNotePath: files.getDailyNotePath(agent.slug, formatMemoryEntryDate(new Date())),
          memoryFolderPath: files.getMemoryFolderPath(agent.slug),
          scratchpadPath: files.getScratchpadPath(agent.slug),
          agentFolderPath: files.getAgentFolderPath(agent.slug),
        }
      : null;
  return {
    slug: agent.slug,
    name: agent.name,
    icon: agent.icon,
    personaBlock: buildAgentPersonaBlock({
      name: agent.name,
      instructions: agent.instructions,
      writeTargets,
    }),
    memory: await loadAgentMemoryInjection(files, agent),
  };
}

export function missingSessionAgent(slug: string): SessionAgent {
  return { slug, name: formatMissingAgentLabel(slug), icon: "", personaBlock: null, memory: null };
}
