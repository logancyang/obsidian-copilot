import { migrateCommands, generateDefaultCommands } from "@/commands/migrator";
import { getCachedCustomCommands } from "@/commands/state";
import { validateCommandName } from "@/commands/customCommandUtils";
import { getSettings, updateSetting } from "@/settings/model";
import type { App } from "obsidian";

const mockUpdateCommands = jest.fn().mockResolvedValue(undefined);

jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: {
    getInstance: jest.fn(() => ({ updateCommands: mockUpdateCommands })),
  },
}));

jest.mock("@/commands/state", () => ({
  getCachedCustomCommands: jest.fn(() => []),
}));

jest.mock("@/commands/customCommandUtils", () => ({
  getCustomCommandsFolder: jest.fn(() => "copilot/custom-prompts"),
  validateCommandName: jest.fn(() => null),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ inlineEditCommands: [] })),
  updateSetting: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

describe("migrator", () => {
  const app = {
    vault: { create: jest.fn().mockResolvedValue({}) },
    fileManager: { processFrontMatter: jest.fn().mockResolvedValue(undefined) },
  } as unknown as App;

  beforeEach(() => {
    jest.clearAllMocks();
    (getCachedCustomCommands as jest.Mock).mockReturnValue([]);
    (validateCommandName as jest.Mock).mockReturnValue(null);
    (getSettings as jest.Mock).mockReturnValue({ inlineEditCommands: [] });
  });

  describe("migrateCommands()", () => {
    it("returns no outcome when no legacy commands exist", async () => {
      await expect(migrateCommands(app)).resolves.toBeNull();
      expect(mockUpdateCommands).not.toHaveBeenCalled();
    });

    it("migrates supported commands and reports their destination", async () => {
      (getSettings as jest.Mock).mockReturnValue({
        inlineEditCommands: [
          {
            name: "Summarize this",
            prompt: "Summarize {}",
            showInContextMenu: true,
            modelKey: "",
          },
        ],
      });

      const result = await migrateCommands(app);

      expect(mockUpdateCommands).toHaveBeenCalledWith([
        expect.objectContaining({ title: "Summarize this", showInSlashMenu: false }),
      ]);
      expect(updateSetting).toHaveBeenCalledWith("inlineEditCommands", []);
      expect(result).toEqual(
        expect.objectContaining({
          id: "custom-commands",
          status: "success",
          details: ["Stored in copilot/custom-prompts."],
        })
      );
    });

    it("preserves unsupported commands and reports required recovery", async () => {
      (getSettings as jest.Mock).mockReturnValue({
        inlineEditCommands: [
          {
            name: "Invalid/name",
            prompt: "Fix {}",
            showInContextMenu: false,
            modelKey: "",
          },
        ],
      });
      (validateCommandName as jest.Mock).mockReturnValue("Names cannot contain slashes");

      const result = await migrateCommands(app);

      expect(app.vault.create).toHaveBeenCalledWith(
        "copilot/custom-prompts/unsupported/Invalid%2Fname.md",
        expect.stringContaining("Names cannot contain slashes")
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: "action-required",
        })
      );
      expect(result?.details?.some((detail) => detail.includes("unsupported"))).toBe(true);
    });
  });

  describe("generateDefaultCommands()", () => {
    it("adds only defaults that are not already present", async () => {
      (getCachedCustomCommands as jest.Mock).mockReturnValue([
        {
          title: "Summarize",
          content: "Existing",
          showInContextMenu: true,
          showInSlashMenu: true,
          order: 1,
          modelKey: "",
          lastUsedMs: 0,
        },
      ]);

      await generateDefaultCommands();

      const saved = mockUpdateCommands.mock.calls[0][0] as Array<{ title: string }>;
      expect(saved.filter(({ title }) => title === "Summarize")).toHaveLength(1);
      expect(saved.length).toBeGreaterThan(1);
    });
  });
});
