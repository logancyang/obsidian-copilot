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
  ownChat?: { chatsFolder: string };
}

// Codex lists MCP tools only on search, so an agent learns from its own prompt that it can ask the others; a chat it was asked into has no ask_agent. A rule the user gives the asked agent is saved by that agent, so the asking agent keeps it out of its own memory.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
// https://github.com/Brevilabs/obsidian-copilot-private/issues/969
const ASK_OTHER_AGENTS =
  "When the user's message @-mentions one of them by name or clearly points to one, ask that agent with the ask_agent tool from obsidian-copilot; never otherwise. A rule the user gives that agent is not yours to save.";
// Codex lists MCP tools only on search, so an agent learns from its own prompt that it drafts a new agent as a card for the user to create, never creating one itself.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
const DRAFT_WITH_TOOL =
  "draft it with the draft_agent tool from obsidian-copilot, which shows them a card to review and create it";
const DRAFT_NEW_AGENTS = `When the user asks you to make a new agent, ${DRAFT_WITH_TOOL}. If you or another agent already handles that job, say so and ask before drafting. You can't create an agent yourself.`;

// Codex finds MCP tools only through its tool search, so an agent's prompt also names the tools for an agent it asked.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
const CONTROL_ASKED_AGENTS =
  "When the user asks how an agent you asked is doing, check with check_agent; when the user answers its question, pass the answer with answer_agent; when the user gives it a new instruction while it works, send that with ask_agent; when the user tells you to stop it, use stop_agent. All are in obsidian-copilot.";

// Codex lists MCP tools only on search, so the agent's own chat names list_chats; another agent's or a Copilot chat's note in the same folder would answer for the wrong chat.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
function recallEarlierChats(chatsFolder: string): string {
  return `When the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said. For that answer use only those chats: never search ${chatsFolder} for it, even within a wider search, and never read a note there that list_chats didn't list, unless the user names it. If none of them covers it, say you haven't discussed it.`;
}

export function describeAgent({ name, title }: Pick<CustomAgent, "name" | "title">): string {
  return title ? `${name} (${title})` : name;
}

// A Copilot chat asked about earlier work read every chat note, agents' included, so it lists its own with list_chats too; the shared prompt is the one prompt a Copilot chat has on every backend, and a line that limited the tool to Copilot chats stopped agents from using it. Codex learns of draft_agent only from the prompt, so a Copilot chat is told it drafts new agents too; that line names chats without a custom agent because an agent's own prompt already says it and an asked agent's hidden chat has no draft_agent.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
export function buildCopilotChatSteering(): string | null {
  if (getCustomAgentsGate() !== "full") return null;
  return `In a chat without a custom agent, when the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said. In a chat without a custom agent, when the user asks you to make a new agent, ${DRAFT_WITH_TOOL}; you can't create an agent yourself.`;
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
    `In this chat you are ${describeAgent(agent)}, a custom agent the user made in Copilot.`,
    `Your folder is ${folder}. Keep your own files in it, and add nothing else to the vault unless the user asks. Do not read or change other agents' folders.`,
    `Your instruction is the body of ${folder}/instructions.md, and only the user edits that file. Your memory is ${folder}/MEMORY.md. When your memory contradicts your instruction, follow your memory.`,
    `Other agents: ${roster}.`,
    ...(others.length > 0 && ownChat ? [ASK_OTHER_AGENTS, CONTROL_ASKED_AGENTS] : []),
    ...(ownChat ? [DRAFT_NEW_AGENTS, recallEarlierChats(ownChat.chatsFolder)] : []),
    buildMemorySaveRules(`${folder}/${MEMORY_FILE_NAME}`, instructionsPath),
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
    name: agent.name,
    prompt: buildAgentPrompt({
      agent,
      folder,
      others: agents.filter((other) => other !== agent),
      instruction: files.instruction,
      memory: files.memory,
      instructionsPath: agent.instructionsPath,
      ...(asked
        ? {}
        : { ownChat: { chatsFolder: `${vaultBase}/${getEffectiveConversationsFolder()}` } }),
    }),
    memoryPath: `${vaultBase}/${agent.memoryPath}`,
  };
}
