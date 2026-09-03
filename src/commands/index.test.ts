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

    it("delegates the exact active Markdown path to Agent Chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
      const activeFile = markdownFile("Notes/Active.md");
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        canUseAgentView: () => true,
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
          },
        },
      } as unknown as CopilotPlugin;
      const submitAgentPrompt = jest.fn();

      registerCommands(plugin, submitAgentPrompt);

      const command = commands.find(({ id }) => id === COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS);
      expect(COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS).toBe("publish-file-to-symposium");
      expect(command).toMatchObject({
        name: COMMAND_NAMES[COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS],
        icon: COMMAND_ICONS[COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS],
      });
      expect(command?.checkCallback?.(true)).toBe(true);
      expect(submitAgentPrompt).not.toHaveBeenCalled();

      expect(command?.checkCallback?.(false)).toBe(true);
      expect(submitAgentPrompt).toHaveBeenCalledTimes(1);
      const buildPrompt = submitAgentPrompt.mock.calls[0][0] as () => string;
      expect(buildPrompt()).toBe(
        'Publish this Markdown note to OpenArtifacts. Use its exact vault-relative path:\n\n"Notes/Active.md"'
      );

      // The request can wait on a probe or an earlier command; a rename in
      // that window must still address the same note.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
      activeFile.path = "Notes/Renamed.md";
      expect(buildPrompt()).toBe(
        'Publish this Markdown note to OpenArtifacts. Use its exact vault-relative path:\n\n"Notes/Renamed.md"'
      );
    });

    it.each([
      ["no active file", null, true],
      ["a non-Markdown active file", markdownFile("Notes/Diagram.canvas"), true],
      // Mobile never constructs the agent session manager, so the command has
      // nothing to delegate to.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/357
      ["a Markdown file where Agent Chat cannot run", markdownFile("Notes/Active.md"), false],
    ])("hides the OpenArtifacts palette command for %s", (_case, activeFile, canUseAgentView) => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        canUseAgentView: () => canUseAgentView,
        app: {
          workspace: {
            getActiveFile: jest.fn(() => activeFile),
          },
        },
      } as unknown as CopilotPlugin;
      const submitAgentPrompt = jest.fn();

      registerCommands(plugin, submitAgentPrompt);

      const command = commands.find(({ id }) => id === COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS);
      expect(command?.checkCallback?.(true)).toBe(false);
      expect(command?.checkCallback?.(false)).toBe(false);
      expect(submitAgentPrompt).not.toHaveBeenCalled();
    });
  });
});
