import { registerCommands } from "@/commands";
import { COMMAND_ICONS, COMMAND_IDS, COMMAND_NAMES } from "@/constants";
import type CopilotPlugin from "@/main";
import { TFile, type Command } from "obsidian";

jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: jest.fn(() => false),
}));

function markdownFile(path: string): TFile {
  const TFileConstructor = TFile as unknown as new (path: string) => TFile;
  return new TFileConstructor(path);
}

describe("commands", () => {
  describe("registerCommands()", () => {
    it("registers the new Quick Chat command with a name distinct from Agent Chat", () => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as CopilotPlugin;

      registerCommands(plugin, jest.fn());

      const command = commands.find(({ id }) => id === COMMAND_IDS.NEW_CHAT);
      expect(command?.name).toBe("New Copilot Quick Chat");
      expect(command?.name).not.toBe(COMMAND_NAMES[COMMAND_IDS.NEW_AGENT_CHAT]);
    });

    it("registers the Symposium palette command and publishes the active Markdown file", () => {
      const activeFile = markdownFile("Notes/Active.md");
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
          },
        },
      } as unknown as CopilotPlugin;
      const publish = jest.fn().mockResolvedValue(undefined);

      registerCommands(plugin, publish);

      const command = commands.find(({ id }) => id === COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM);
      expect(command).toMatchObject({
        name: COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM],
        icon: COMMAND_ICONS[COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM],
      });
      expect(command?.checkCallback?.(true)).toBe(true);
      expect(publish).not.toHaveBeenCalled();

      expect(command?.checkCallback?.(false)).toBe(true);
      expect(publish).toHaveBeenCalledWith(activeFile);
    });

    it.each([
      ["no active file", null],
      ["a non-Markdown active file", markdownFile("Notes/Diagram.canvas")],
    ])("hides the Symposium palette command for %s", (_case, activeFile) => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
          },
        },
      } as unknown as CopilotPlugin;
      const publish = jest.fn().mockResolvedValue(undefined);

      registerCommands(plugin, publish);

      const command = commands.find(({ id }) => id === COMMAND_IDS.PUBLISH_FILE_TO_SYMPOSIUM);
      expect(command?.checkCallback?.(true)).toBe(false);
      expect(command?.checkCallback?.(false)).toBe(false);
      expect(publish).not.toHaveBeenCalled();
    });
  });
});
