import { createMemoryVault } from "@/__tests__/memoryVault";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands, updateCachedCommands } from "@/commands/state";
import type { CustomCommand } from "@/commands/type";
import { DEFAULT_SETTINGS } from "@/constants";
import * as settingsModel from "@/settings/model";

jest.mock("@/logger", () => ({ logWarn: jest.fn(), logError: jest.fn(), logInfo: jest.fn() }));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3075";
const DIR = ".copilot/copilot-custom-prompts";

function command(title: string, overrides: Partial<CustomCommand> = {}): CustomCommand {
  return {
    title,
    content: `${title} prompt`,
    modelKey: "",
    showInContextMenu: false,
    showInSlashMenu: true,
    order: 0,
    lastUsedMs: 0,
    ...overrides,
  };
}

function setup() {
  jest
    .spyOn(settingsModel, "getSettings")
    .mockReturnValue({ ...DEFAULT_SETTINGS, copilotFolder: ".copilot" });
  (CustomCommandManager as unknown as { instance?: unknown }).instance = undefined;
  updateCachedCommands([]);
  const memory = createMemoryVault();
  return { ...memory, manager: CustomCommandManager.getInstance(memory.app) };
}

describe("customCommandManager", () => {
  describe("CustomCommandManager", () => {
    it(`creates, edits, renames and deletes a command in a hidden Copilot folder ${ISSUE}`, async () => {
      const { manager, files, trashed } = setup();

      await manager.createCommand(command("Before"));
      expect(files.get(`${DIR}/Before.md`)).toContain("copilot-command-slash-enabled: true");

      await manager.updateCommand(command("Before", { content: "new prompt" }), "Before");
      expect(files.get(`${DIR}/Before.md`)?.endsWith("---\nnew prompt")).toBe(true);

      await manager.updateCommand(command("After", { content: "new prompt" }), "Before");
      expect([...files.keys()]).toEqual([`${DIR}/After.md`]);
      expect(getCachedCustomCommands().map((c) => c.title)).toEqual(["After"]);

      await manager.deleteCommand(command("After"));
      expect(trashed).toEqual([`${DIR}/After.md`]);
      expect(getCachedCustomCommands()).toEqual([]);
    });

    it(`keeps a prompt edited outside Copilot when a command is used or reordered ${ISSUE}`, async () => {
      const { manager, files } = setup();
      await manager.createCommand(command("First"));
      await manager.createCommand(command("Second"));
      for (const title of ["First", "Second"]) {
        files.set(
          `${DIR}/${title}.md`,
          files.get(`${DIR}/${title}.md`)!.replace("prompt", "edited")
        );
      }

      await manager.recordUsage(command("First"));
      await manager.reorderCommands([command("Second"), command("First")]);

      expect(files.get(`${DIR}/First.md`)).not.toContain("copilot-command-last-used: 0");
      expect(files.get(`${DIR}/Second.md`)).toContain("copilot-command-context-menu-order: 0");
      for (const title of ["First", "Second"]) {
        expect(files.get(`${DIR}/${title}.md`)?.endsWith(`---\n${title} edited`)).toBe(true);
      }
    });
  });
});
