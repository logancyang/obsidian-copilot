import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import { MEMORY_FILE_NAME } from "@/agents/customAgentFiles";
import { buildMemorySaveRules } from "@/agents/memorySaveRules";
import { logWarn } from "@/logger";

export interface AgentSessionPrompt {
  slug: string;
  prompt: string;
  memoryPath?: string;
}

export interface AgentPromptInput {
  agent: Pick<CustomAgent, "name" | "title">;
  folder: string;
  others: readonly Pick<CustomAgent, "name" | "title">[];
  instruction: string;
  memory: string;
  saveRules?: { instructionsPath: string };
}

function describeAgent({ name, title }: Pick<CustomAgent, "name" | "title">): string {
  return title ? `${name} (${title})` : name;
}

export function buildAgentPrompt({
  agent,
  folder,
  others,
  instruction,
  memory,
  saveRules,
}: AgentPromptInput): string {
  const roster = others.length > 0 ? others.map(describeAgent).join("; ") : "none";
  return [
    `In this chat you are ${describeAgent(agent)}, a custom agent the user made in Copilot.`,
    `Your folder is ${folder}. Keep your own files in it, and add nothing else to the vault unless the user asks. Do not read or change other agents' folders.`,
    `Your instruction is the body of ${folder}/instructions.md, and only the user edits that file. Your memory is ${folder}/MEMORY.md. When your memory contradicts your instruction, follow your memory.`,
    `Other agents: ${roster}.`,
    ...(saveRules
      ? [buildMemorySaveRules(`${folder}/${MEMORY_FILE_NAME}`, saveRules.instructionsPath)]
      : []),
    `<instruction>\n${instruction}\n</instruction>`,
    `<memory>\n${memory}\n</memory>`,
  ].join("\n\n");
}

export async function loadAgentSessionPrompt(
  store: CustomAgentStore,
  slug: string,
  vaultBase: string,
  { saveRules = true }: { saveRules?: boolean } = {}
): Promise<AgentSessionPrompt | null> {
  if (getCustomAgentsGate() !== "full") return null;
  const agents = store.getAgents();
  const agent = agents.find((candidate) => candidate.slug === slug);
  if (!agent) return null;
  let files: Awaited<ReturnType<CustomAgentStore["loadForSession"]>>;
  try {
    files = await store.loadForSession(slug);
  } catch (error) {
    // A folder moved or deleted on disk can still be in the vault index for a moment, so its read fails instead of finding nothing.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/937
    logWarn(`[Custom agents] Could not load ${slug} for a chat`, error);
    return null;
  }
  if (!files) return null;
  const folder = `${vaultBase}/${agent.folderPath}`;
  return {
    slug,
    prompt: buildAgentPrompt({
      agent,
      folder,
      others: agents.filter((other) => other !== agent),
      instruction: files.instruction,
      memory: files.memory,
      ...(saveRules ? { saveRules: { instructionsPath: agent.instructionsPath } } : {}),
    }),
    ...(saveRules ? { memoryPath: `${vaultBase}/${agent.memoryPath}` } : {}),
  };
}
