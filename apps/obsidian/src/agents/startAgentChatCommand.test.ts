import { AgentUnavailableError } from "@/agents/agentUnavailableError";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import {
  registerStartAgentChatCommand,
  START_AGENT_CHAT_COMMAND_ID,
} from "@/agents/startAgentChatCommand";
import { setCustomAgentsAccess, verifyStoredToken } from "@/agents/testing/customAgentsAccess";
import { AgentPickerModal } from "@/agents/ui/AgentPickerModal";
import { logError } from "@/logger";
import { Notice, type Command, type Plugin } from "obsidian";

jest.mock("@/entitlement");
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/agents/ui/AgentPickerModal", () => ({
  AgentPickerModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

const COCO = { slug: "coco", name: "Coco", title: "Houseplant carer" } as CustomAgent;

function buildPlugin() {
  const commands = new Map<string, Command>();
  const plugin = {
    app: {},
    addCommand: jest.fn((command: Command) => {
      commands.set(command.id, command);
      return command;
    }),
    removeCommand: jest.fn((id: string) => commands.delete(id)),
  };
  return { plugin: plugin as unknown as Plugin, commands };
}

const store = { getAgents: () => [COCO] } as unknown as CustomAgentStore;

function pickAgentFromPalette(commands: Map<string, Command>, agent: CustomAgent): void {
  commands.get(START_AGENT_CHAT_COMMAND_ID)?.callback?.();
  const onChoose = jest.mocked(AgentPickerModal).mock.calls.at(-1)?.[2];
  onChoose?.(agent);
}

describe("startAgentChatCommand", () => {
  describe("registerStartAgentChatCommand()", () => {
    beforeEach(() => {
      jest.mocked(AgentPickerModal).mockClear();
    });

    it("adds Start a chat with a teammate while custom agents are available, listing the store's agents, and starts a chat with the one picked", async () => {
      await setCustomAgentsAccess("team");
      const { plugin, commands } = buildPlugin();
      const startChat = jest.fn(async () => undefined);

      const dispose = registerStartAgentChatCommand(plugin, store, startChat);
      pickAgentFromPalette(commands, COCO);
      dispose();

      expect(plugin.addCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          id: START_AGENT_CHAT_COMMAND_ID,
          name: "Start a chat with a teammate",
        })
      );
      expect(jest.mocked(AgentPickerModal).mock.calls[0][1]).toEqual([COCO]);
      expect(startChat).toHaveBeenCalledWith(COCO);
    });

    it("adds no command while custom agents are locked (https://github.com/Brevilabs/obsidian-copilot-private/issues/937)", async () => {
      await setCustomAgentsAccess("free");
      const { plugin, commands } = buildPlugin();

      const dispose = registerStartAgentChatCommand(plugin, store, jest.fn());
      dispose();

      expect(plugin.addCommand).not.toHaveBeenCalled();
      expect(commands.size).toBe(0);
    });

    it("removes the command when the license loses custom agents and adds it back when they return", async () => {
      await setCustomAgentsAccess("team");
      const { plugin, commands } = buildPlugin();
      const dispose = registerStartAgentChatCommand(plugin, store, jest.fn());

      await verifyStoredToken(false);
      const afterLoss = commands.has(START_AGENT_CHAT_COMMAND_ID);
      await verifyStoredToken(true);
      const afterReturn = commands.has(START_AGENT_CHAT_COMMAND_ID);
      dispose();

      expect([afterLoss, afterReturn, commands.has(START_AGENT_CHAT_COMMAND_ID)]).toEqual([
        false,
        true,
        false,
      ]);
    });

    it("tells the user and logs the cause when the chat cannot start", async () => {
      await setCustomAgentsAccess("team");
      const { plugin, commands } = buildPlugin();
      const failure = new Error("Codex needs an update to run Copilot Teammates.");
      let failed!: () => void;
      const reported = new Promise<void>((resolve) => (failed = resolve));
      jest.mocked(logError).mockImplementationOnce(() => failed());

      const dispose = registerStartAgentChatCommand(plugin, store, async () => {
        throw failure;
      });
      pickAgentFromPalette(commands, COCO);
      await reported;
      dispose();

      expect(logError).toHaveBeenCalledWith(
        "[Custom agents] Could not start a chat with coco",
        failure
      );
      expect(Notice).toHaveBeenCalledWith("Could not start the chat. Check the Copilot log.");
    });

    it("tells the user why when the agent's model can't run on this device, for https://github.com/Brevilabs/obsidian-copilot-private/issues/962", async () => {
      await setCustomAgentsAccess("team");
      const { plugin, commands } = buildPlugin();
      const reason = "Coco runs on OpenCode, which isn't set up on this device.";
      let failed!: () => void;
      const reported = new Promise<void>((resolve) => (failed = resolve));
      jest.mocked(logError).mockImplementationOnce(() => failed());

      const dispose = registerStartAgentChatCommand(plugin, store, async () => {
        throw new AgentUnavailableError(reason);
      });
      pickAgentFromPalette(commands, COCO);
      await reported;
      dispose();

      expect(Notice).toHaveBeenCalledWith(reason);
    });
  });
});
