import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { TFile, Vault } from "obsidian";
import * as settingsModel from "@/settings/model";
import * as systemPromptUtils from "@/system-prompts/systemPromptUtils";
import * as logger from "@/logger";
import * as utils from "@/utils";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("obsidian", () => ({
  TFile: jest.fn(),
  Vault: jest.fn(),
  normalizePath: jest.fn((path: string) => path),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  updateSetting: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/system-prompts/systemPromptUtils", () => ({
  getSystemPromptsFolder: jest.fn(() => "SystemPrompts"),
  getPromptFilePath: jest.fn((title: string) => `SystemPrompts/${title}.md`),
  getPromptFilePathInFolder: jest.fn(
    (title: string, folder?: string) => `${folder ?? "SystemPrompts"}/${title}.md`
  ),
  ensurePromptFrontmatter: jest.fn(),
  loadAllSystemPrompts: jest.fn(),
}));

jest.mock("@/utils", () => {
  const actual = jest.requireActual<{ stripFrontmatter: unknown }>("@/utils");
  return {
    ensureFolderExists: jest.fn(),
    stripFrontmatter: actual.stripFrontmatter,
  };
});

describe("migrateSystemPromptsFromSettings", () => {
  let mockVault: Vault;
  let originalApp: typeof window.app;

  beforeEach(() => {
    jest.clearAllMocks();

    (utils.ensureFolderExists as jest.Mock).mockReset();
    (utils.ensureFolderExists as jest.Mock).mockResolvedValue(undefined);

    mockVault = {
      getAbstractFileByPath: jest.fn(),
      createFolder: jest.fn(),
      create: jest.fn(),
      read: jest.fn(async () => {
        const settings = settingsModel.getSettings() as { userSystemPrompt?: string };
        const legacyPrompt = settings?.userSystemPrompt ?? "";
        return `---\ntest: true\n---\n${legacyPrompt}`;
      }),
    } as unknown as Vault;

    originalApp = window.app;
    window.app = {
      vault: mockVault,
    } as unknown as typeof window.app;
  });

  afterEach(() => {
    window.app = originalApp;
  });

  it("skips migration when userSystemPrompt is empty", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "",
    });

    const result = await migrateSystemPromptsFromSettings(window.app);

    expect(logger.logInfo).toHaveBeenCalledWith("No legacy userSystemPrompt to migrate");
    expect(mockVault.create).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("skips migration when userSystemPrompt is whitespace only", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "   ",
    });

    await migrateSystemPromptsFromSettings(window.app);

    expect(logger.logInfo).toHaveBeenCalledWith("No legacy userSystemPrompt to migrate");
    expect(mockVault.create).not.toHaveBeenCalled();
  });

  it("creates system prompts folder if it does not exist", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "This is a legacy system prompt.",
    });
    (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null).mockReturnValueOnce(
      mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      })
    );

    await migrateSystemPromptsFromSettings(window.app);

    expect(utils.ensureFolderExists).toHaveBeenCalledWith(mockVault, "SystemPrompts");
  });

  it("does not create folder if it already exists", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "This is a legacy system prompt.",
    });
    (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null).mockReturnValueOnce(
      mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      })
    );

    await migrateSystemPromptsFromSettings(window.app);

    expect(utils.ensureFolderExists).toHaveBeenCalledWith(mockVault, "SystemPrompts");
  });

  it("migrates legacy prompt to file with correct content", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null).mockReturnValueOnce(
      mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      })
    );

    const result = await migrateSystemPromptsFromSettings(window.app);

    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt.md",
      legacyPrompt
    );
    expect(result).toEqual(expect.objectContaining({ id: "system-prompt", status: "success" }));
  });

  it("preserves whitespace from legacy prompt content", async () => {
    const legacyPrompt = "  This is a legacy system prompt.  \n\n";
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(
        mockTFile({
          path: "SystemPrompts/Migrated Custom System Prompt.md",
        })
      );

    await migrateSystemPromptsFromSettings(window.app);

    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt.md",
      "  This is a legacy system prompt.  \n\n"
    );
  });

  it("adds frontmatter to migrated file", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockFile);

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(window.app);

    expect(systemPromptUtils.ensurePromptFrontmatter).toHaveBeenCalledWith(
      window.app,
      mockFile,
      expect.objectContaining({
        title: "Migrated Custom System Prompt",
        content: legacyPrompt,
      })
    );
  });

  it("clears legacy userSystemPrompt from settings after migration", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockFile);

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(window.app);

    expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
  });

  it("sets migrated prompt as default", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockFile);

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(window.app);

    expect(settingsModel.updateSetting).toHaveBeenCalledWith(
      "defaultSystemPromptTitle",
      "Migrated Custom System Prompt"
    );
  });

  it("reloads all prompts after migration", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockFile);

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(window.app);

    expect(systemPromptUtils.loadAllSystemPrompts).toHaveBeenCalled();
  });

  it("generates unique name when default file already exists", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const existingFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });
    const newFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt 2.md",
    });

    Object.setPrototypeOf(newFile, TFile.prototype);

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(existingFile)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(newFile);

    await migrateSystemPromptsFromSettings(window.app);

    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt 2.md",
      legacyPrompt
    );
    expect(logger.logInfo).toHaveBeenCalledWith(
      'Default name already exists, using unique name: "Migrated Custom System Prompt 2"'
    );
    expect(settingsModel.updateSetting).toHaveBeenCalledWith(
      "defaultSystemPromptTitle",
      "Migrated Custom System Prompt 2"
    );
  });

  it("generates incrementing unique names when multiple files exist", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const newFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt 3.md",
    });

    Object.setPrototypeOf(newFile, TFile.prototype);

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce({ path: "exists" })
      .mockReturnValueOnce({ path: "exists" })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(newFile);

    await migrateSystemPromptsFromSettings(window.app);

    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt 3.md",
      legacyPrompt
    );
  });

  it("logs clearing message after migration", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockFile);

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(window.app);

    expect(logger.logInfo).toHaveBeenCalledWith("Cleared legacy userSystemPrompt field");
  });

  it("handles errors gracefully and preserves data when unsupported save fails", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const error = new Error("Vault error");

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
    (utils.ensureFolderExists as jest.Mock).mockRejectedValue(error);

    await migrateSystemPromptsFromSettings(window.app);

    expect(logger.logError).toHaveBeenCalledWith(
      "Failed to migrate legacy userSystemPrompt:",
      error
    );
    expect(settingsModel.updateSetting).not.toHaveBeenCalledWith("userSystemPrompt", "");
  });

  it("does not throw error on migration failure", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const error = new Error("Vault error");

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
    (utils.ensureFolderExists as jest.Mock).mockRejectedValue(error);

    await expect(migrateSystemPromptsFromSettings(window.app)).resolves.not.toThrow();
  });

  it("sets correct timestamps for migrated prompt", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = mockTFile({
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    });

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(mockFile);

    Object.setPrototypeOf(mockFile, TFile.prototype);

    const beforeTime = Date.now();
    await migrateSystemPromptsFromSettings(window.app);
    const afterTime = Date.now();

    expect(systemPromptUtils.ensurePromptFrontmatter).toHaveBeenCalledWith(
      window.app,
      mockFile,
      expect.objectContaining({
        title: "Migrated Custom System Prompt",
        content: legacyPrompt,
        lastUsedMs: 0,
      })
    );

    const callArgs = (systemPromptUtils.ensurePromptFrontmatter as jest.Mock).mock.calls[0][2] as {
      createdMs: number;
      modifiedMs: number;
    };
    expect(callArgs.createdMs).toBeGreaterThanOrEqual(beforeTime);
    expect(callArgs.createdMs).toBeLessThanOrEqual(afterTime);
    expect(callArgs.modifiedMs).toBeGreaterThanOrEqual(beforeTime);
    expect(callArgs.modifiedMs).toBeLessThanOrEqual(afterTime);
  });

  describe("write-then-verify safety with unsupported folder", () => {
    it("clears userSystemPrompt and saves to unsupported when verification fails", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockFile)
        .mockReturnValueOnce(null);

      (mockVault.read as jest.Mock).mockResolvedValueOnce(
        `---\ntest: true\n---\nDifferent content that does not match!`
      );

      await migrateSystemPromptsFromSettings(window.app);

      expect(mockVault.create).toHaveBeenCalledWith(
        "SystemPrompts/unsupported/Migrated System Prompt (Failed Verification).md",
        expect.stringContaining("Migration failed: content verification mismatch")
      );

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("preserves userSystemPrompt when all save attempts fail", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const error = new Error("Disk full");

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

      (mockVault.create as jest.Mock).mockRejectedValueOnce(error).mockRejectedValueOnce(error);

      await migrateSystemPromptsFromSettings(window.app);

      expect(settingsModel.updateSetting).not.toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("saves to unsupported and clears userSystemPrompt when vault.read throws", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockFile)
        .mockReturnValueOnce(null);

      (mockVault.read as jest.Mock).mockRejectedValueOnce(new Error("Failed to read file"));

      await migrateSystemPromptsFromSettings(window.app);

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("unsupported/"),
        expect.any(String)
      );

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("clears userSystemPrompt when main migration fails but unsupported save succeeds", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const error = new Error("Vault error");

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (utils.ensureFolderExists as jest.Mock)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(undefined);
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null);

      await migrateSystemPromptsFromSettings(window.app);

      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("unsupported/"),
        expect.stringContaining("Migration failed")
      );

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("clears userSystemPrompt and sets default on successful verification", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockFile);

      await migrateSystemPromptsFromSettings(window.app);

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
      expect(settingsModel.updateSetting).toHaveBeenCalledWith(
        "defaultSystemPromptTitle",
        "Migrated Custom System Prompt"
      );
    });

    it("preserves whitespace and verifies exact content match", async () => {
      const legacyPrompt = "  This is a legacy system prompt.  \n\n";
      const mockFile = mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockFile);

      await migrateSystemPromptsFromSettings(window.app);

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("normalizes CRLF/LF differences in verification", async () => {
      const legacyPrompt = "Line 1\r\nLine 2\r\nLine 3";
      const mockFile = mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockFile);

      (mockVault.read as jest.Mock).mockResolvedValueOnce(
        `---\ntest: true\n---\nLine 1\nLine 2\nLine 3`
      );

      await migrateSystemPromptsFromSettings(window.app);

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("handles double newline after frontmatter (Obsidian format)", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = mockTFile({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      });

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(mockFile);

      (mockVault.read as jest.Mock).mockResolvedValueOnce(
        `---\ntest: true\n---\n\n${legacyPrompt}`
      );

      await migrateSystemPromptsFromSettings(window.app);

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
      expect(settingsModel.updateSetting).toHaveBeenCalledWith(
        "defaultSystemPromptTitle",
        "Migrated Custom System Prompt"
      );
    });
  });
});
