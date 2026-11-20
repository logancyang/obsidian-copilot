import type { ToolDescriptionUpFront } from "@/agentMode";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import { MEMORY_FILE_NAME } from "@/agents/customAgentFiles";
import { buildMemorySaveRules } from "@/agents/memorySaveRules";
import { getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { logWarn } from "@/logger";

export interface AgentSessionPrompt {
  slug: string;
  prompt: string;
  name: string;
  memoryPath: string;
}

export interface AgentPromptInput {
  agent: Pick<CustomAgent, "name" | "title">;
  folder: string;
  others: readonly Pick<CustomAgent, "name" | "title">[];
  instruction: string;
  memory: string;
  instructionsPath: string;
  ownChat?: { chatsFolder: string; toolDescriptionUpFront: ToolDescriptionUpFront };
}

type AgentChatKind = { asked: true } | { toolDescriptionUpFront: ToolDescriptionUpFront };

export const ASK_AGENT_PROMPT_HINT =
  "When the user's message @-mentions one of the user's agents by name or clearly points to one, ask that agent with the ask_agent tool from obsidian-copilot; never otherwise.";

export const DRAFT_AGENT_PROMPT_HINT =
  "When the user asks you to make a new agent, draft it with the draft_agent tool from obsidian-copilot, which shows them a card to review and create it. If you or another agent already handles that job, say so and ask before drafting. You can't create an agent yourself.";

export const LIST_CHATS_PROMPT_HINT =
  "When the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said.";

// A rule the user gives the asked agent is saved by that agent, so the asking agent keeps it out of its own memory; no tool description says so.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/969
const NOT_YOURS_TO_SAVE = "A rule the user gives another agent is not yours to save.";

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
  // A model shown only the start of a tool's description misses the rules after it: an agent stopped passing a request to the agent whose job it named unless the ask rule sat beside the list of agents, and drafted a duplicate of an agent without the draft rule.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/986
  const toolRules = ownChat !== undefined && ownChat.toolDescriptionUpFront !== "full";
  return [
    `In this chat you are ${describeAgent(agent)}, an agent the user made in Copilot.`,
    `Your folder is ${folder}. Keep your own files in it, and add nothing else to the vault unless the user asks. Do not read or change other agents' folders.`,
    `Your instruction is the body of ${folder}/instructions.md, and only the user edits that file. Your memory is ${folder}/MEMORY.md. When your memory contradicts your instruction, follow your memory.`,
    `Other agents: ${roster}.`,
    ...(toolRules && others.length > 0 ? [ASK_AGENT_PROMPT_HINT] : []),
    ...(ownChat && others.length > 0 ? [NOT_YOURS_TO_SAVE] : []),
    ...(toolRules ? [DRAFT_AGENT_PROMPT_HINT] : []),
    ...(ownChat ? [recallEarlierChats(ownChat.chatsFolder)] : []),
    buildMemorySaveRules(`${folder}/${MEMORY_FILE_NAME}`, instructionsPath),
    `<instruction>\n${instruction}\n</instruction>`,
    `<memory>\n${memory}\n</memory>`,
  ].join("\n\n");
}

export async function loadAgentSessionPrompt(
  store: CustomAgentStore,
  slug: string,
  vaultBase: string,
  chat: AgentChatKind
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
    name: agent.name,
    prompt: buildAgentPrompt({
      agent,
      folder,
      others: agents.filter((other) => other !== agent),
      instruction: files.instruction,
      memory: files.memory,
      instructionsPath: agent.instructionsPath,
      ...("asked" in chat
        ? {}
        : {
            ownChat: {
              chatsFolder: `${vaultBase}/${getEffectiveConversationsFolder()}`,
              toolDescriptionUpFront: chat.toolDescriptionUpFront,
            },
          }),
    }),
    memoryPath: `${vaultBase}/${agent.memoryPath}`,
  };
}
