import type { ToolListing } from "@/agentMode/session/copilotMcpServer";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import { localDate } from "@/agents/agentMemoryFile";
import { buildMemorySaveRules } from "@/agents/memorySaveRules";
import { withoutEndedRules } from "@/agents/memorySaves";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { logWarn } from "@/logger";

export interface AgentSessionPrompt {
  slug: string;
  prompt: string;
}

export interface AgentPromptInput {
  agent: Pick<CustomAgent, "name" | "title">;
  folder: string;
  others: readonly Pick<CustomAgent, "name" | "title">[];
  instruction: string;
  memory: string;
  instructionsPath: string;
  ownChat?: { chatsFolder: string };
}

// Given only the word "teammate", weaker models took the user's teammates for people; one sentence saying what they are made the difference the word alone did not.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/999
export const AI_TEAMMATE_DEFINITION =
  "An AI teammate is an AI assistant the user made in Copilot, not a person.";

// A Copilot chat reads no teammate prompt, so the first teammate tool in a listing that can reach one opens with the definition. OpenCode's shared folder listing reaches Copilot chats too, so a teammate's own chat there reads it twice; a listing written for one teammate's chat leaves it to the prompt.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/999
export function mayReachCopilotChat({ agentSlug }: ToolListing): boolean {
  return agentSlug === undefined;
}

// With ask_teammate's whole description in view, weaker models passed a request that points at another agent by its job far less often unless the ask rule sat beside the list of agents.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/986
export const ASK_AGENT_PROMPT_HINT =
  "When the user's message @-mentions one of the user's AI teammates by name or clearly points to one, ask that AI teammate with the ask_teammate tool from obsidian-copilot; never otherwise.";

export const LIST_CHATS_PROMPT_HINT =
  "When the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said.";

// A rule the user gives the asked agent is saved by that agent, so the asking agent keeps it out of its own memory; no tool description says so.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/969
const NOT_YOURS_TO_SAVE = "A rule the user gives another AI teammate is not yours to save.";

// Every coding agent gets the whole recall paragraph: list_chats' description carries neither reading a listed note nor the scope, and without the scope another agent's or a Copilot chat's note in the same folder answered for the wrong chat.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
function recallEarlierChats(chatsFolder: string): string {
  return `${LIST_CHATS_PROMPT_HINT} For that answer use only those chats: never search ${chatsFolder} for it, even within a wider search, and never read a note there that list_chats didn't list, unless the user names it. If none of them covers it, say you haven't discussed it.`;
}

export function describeAgent({ name, title }: Pick<CustomAgent, "name" | "title">): string {
  return title ? `${name} (${title})` : name;
}

export function buildAgentPrompt({
  agent,
  folder,
  others,
  instruction,
  memory,
  instructionsPath,
  ownChat,
}: AgentPromptInput): string {
  const roster = others.length > 0 ? others.map(describeAgent).join("; ") : "none";
  return [
    `In this chat you are ${describeAgent(agent)}, an AI teammate. ${AI_TEAMMATE_DEFINITION}`,
    `Your folder is ${folder}. Keep your own files in it, and add nothing else to the vault unless the user asks. Do not read or change other AI teammates' folders.`,
    `Your instruction is the body of ${folder}/instructions.md, and only the user edits that file. Your memory is ${folder}/MEMORY.md. It is your only memory: never save to CLAUDE.md, AGENTS.md or any other memory. When your memory contradicts your instruction, follow your memory.`,
    `Other AI teammates: ${roster}.`,
    ...(ownChat && others.length > 0 ? [ASK_AGENT_PROMPT_HINT, NOT_YOURS_TO_SAVE] : []),
    ...(ownChat ? [recallEarlierChats(ownChat.chatsFolder)] : []),
    buildMemorySaveRules(instructionsPath),
    `<instruction>\n${instruction}\n</instruction>`,
    `<memory>\n${memory}\n</memory>`,
  ].join("\n\n");
}

export async function loadAgentSessionPrompt(
  store: CustomAgentStore,
  slug: string,
  vaultBase: string,
  { asked = false }: { asked?: boolean } = {}
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
      memory: withoutEndedRules(files.memory, localDate(new Date())),
      instructionsPath: agent.instructionsPath,
      ...(asked
        ? {}
        : { ownChat: { chatsFolder: `${vaultBase}/${getEffectiveConversationsFolder()}` } }),
    }),
  };
}
