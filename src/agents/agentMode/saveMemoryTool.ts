import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type {
  HostedTool,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import { localDate, saveMemoryRule, type RuleToSave } from "@/agents/agentMemoryFile";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import type { MemorySave } from "@/agents/memorySaves";
import { USER_SENDER } from "@/constants";
import { err2String } from "@/utils";
import type { Vault } from "obsidian";

export const SAVE_MEMORY_TOOL_NAME = "save_memory";
const UNAVAILABLE_TEXT = "Copilot Teammates isn't available right now. Tell the user.";

type CallingSession = Pick<AgentSession, "agentSlug" | "getState" | "store">;

export interface SaveMemoryCaller {
  session: CallingSession;
  askedFrom: Pick<AgentSession, "getState"> | null;
}

export interface SaveMemoryToolHost {
  agents: () => readonly CustomAgent[];
  callerOf: (chat: ChatStateHost | null) => SaveMemoryCaller | null;
  vault: Vault;
}

const SAVE_MEMORY_TOOL: McpToolDefinition = Object.freeze({
  name: SAVE_MEMORY_TOOL_NAME,
  description:
    "Save one rule, or where something lives in the vault, to your memory, or replace one in it.",
  inputSchema: {
    type: "object",
    properties: {
      rule: {
        type: "string",
        description:
          'Write each rule as one plain sentence the user would agree with. If it only holds until a date, start with "Until YYYY-MM-DD:".',
      },
      why: { type: "string", description: "Why it came up." },
      replaces: {
        type: "string",
        description: "If the new rule replaces an existing one: that rule, word for word.",
      },
      contradicts: {
        type: "string",
        description:
          "The sentence of your instruction this rule goes against, word for word. A rule that goes against your instruction is still saved when the user doesn't ask to change the instruction itself.",
      },
    },
    required: ["rule", "why"],
  },
  // A save never asks the user, and read-only is the one mark every coding agent runs a Copilot tool on without asking; it also lets one run the tool in Plan mode and side by side, so the call refuses Plan and writes one save at a time.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
  _meta: { "anthropic/alwaysLoad": true },
});

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;
}

function readRuleToSave(args: unknown): RuleToSave | null {
  const fields = (args ?? {}) as Record<string, unknown>;
  const [rule, why] = [text(fields.rule), text(fields.why)];
  if (!rule || !why) return null;
  const [replaces, contradicts] = [text(fields.replaces), text(fields.contradicts)];
  return {
    rule,
    why,
    ...(replaces ? { replaces } : {}),
    ...(contradicts ? { contradicts } : {}),
  };
}

// The chat draws a save's line from what the call saved, kept on the reply being written, which the chat's note also keeps.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/988
function recordSave({ store }: CallingSession, save: MemorySave): void {
  const reply = [...store.getDisplayMessages()]
    .reverse()
    .find((message) => message.sender !== USER_SENDER);
  if (!reply) return;
  store.setFileChanges(
    reply.id,
    [...(reply.fileChanges ?? [])],
    [...(reply.memorySaves ?? []), save]
  );
}

export function createSaveMemoryTool(host: SaveMemoryToolHost): HostedTool {
  let saving: Promise<unknown> = Promise.resolve();
  return {
    definition: SAVE_MEMORY_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    // Only a chat that runs as an agent has a memory; OpenCode lists a folder's tools once for every chat in it, so there it is listed while any agent exists and the call turns the other chats down.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
    listedAs: ({ shared, agentSlug }: ToolListing) =>
      getCustomAgentsGate() === "full" &&
      (shared ? host.agents().length > 0 : agentSlug !== undefined)
        ? SAVE_MEMORY_TOOL
        : null,
    promptHint: "To save a rule to your memory, use the save_memory tool from obsidian-copilot.",
    call: async (args, chat) => {
      const save = readRuleToSave(args);
      if (!save) {
        return { text: "rule and why must be non-empty strings.", isError: true };
      }
      if (getCustomAgentsGate() !== "full") return { text: UNAVAILABLE_TEXT, isError: false };
      const caller = host.callerOf(chat);
      const agent = host.agents().find((candidate) => candidate.slug === caller?.session.agentSlug);
      if (!caller || !agent) {
        return {
          text: `This chat has no memory to save to. Don't call ${SAVE_MEMORY_TOOL_NAME} again.`,
          isError: false,
        };
      }
      // A chat in Plan mode changes nothing, and an asked agent follows the mode of the chat that asked it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
      if ([caller.session, caller.askedFrom].some((s) => s?.getState()?.mode?.current === "plan")) {
        return {
          text: "Nothing saved: you can't save a rule in this mode. Tell the user.",
          isError: false,
        };
      }
      // A coding agent may run read-only tools side by side, and two first saves would each create the file, the later over the earlier.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
      const write = saving.then(() =>
        saveMemoryRule(host.vault, agent.memoryPath, save, localDate(new Date()))
      );
      saving = write.catch(() => undefined);
      let written: Awaited<typeof write>;
      try {
        written = await write;
      } catch (error) {
        return { text: `Couldn't save: ${err2String(error)}`, isError: true };
      }
      // A rule to replace that isn't in the memory saves nothing, so a misquoted rule never leaves a second rule beside the old one.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/988
      if (!written) {
        return {
          text: `Nothing saved: your memory has no rule "${save.replaces}".`,
          isError: false,
        };
      }
      recordSave(caller.session, {
        rule: save.rule,
        ...(written.replaced ? { replaced: written.replaced } : {}),
        ...(save.contradicts ? { contradicts: save.contradicts } : {}),
        agentName: agent.name,
        memoryPath: agent.memoryPath,
      });
      return {
        text: "Saved. The chat shows the user each save, so don't announce it in your reply.",
        isError: false,
      };
    },
  };
}
