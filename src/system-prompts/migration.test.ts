import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { TFile, Vault } from "obsidian";
import * as settingsModel from "@/settings/model";
import * as systemPromptUtils from "@/system-prompts/systemPromptUtils";
import * as logger from "@/logger";
import * as utils from "@/utils";

// Mock Obsidian
jest.mock("obsidian", () => ({
  TFile: jest.fn(),
  Vault: jest.fn(),
  normalizePath: jest.fn((path: string) => path),
}));

// Mock settings
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  updateSetting: jest.fn(),
}));

// Mock logger
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

// Mock system prompt utils
jest.mock("@/system-prompts/systemPromptUtils", () => ({
  getSystemPromptsFolder: jest.fn(() => "SystemPrompts"),
  getPromptFilePath: jest.fn((title: string) => `SystemPrompts/${title}.md`),
  ensurePromptFrontmatter: jest.fn(),
  loadAllSystemPrompts: jest.fn(),
}));

// Mock utils
jest.mock("@/utils", () => {
  const actual = jest.requireActual("@/utils");
  return {
    ensureFolderExists: jest.fn(),
    stripFrontmatter: actual.stripFrontmatter,
  };
});

// Mock ConfirmModal
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn().mockImplementation(() => ({
    open: jest.fn(),
  })),
}));

describe("migrateSystemPromptsFromSettings", () => {
  let mockVault: Vault;
  let originalApp: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the utils mock
    (utils.ensureFolderExists as jest.Mock).mockReset();
    (utils.ensureFolderExists as jest.Mock).mockResolvedValue(undefined);

    // Create mock vault with read method that returns content with frontmatter
    mockVault = {
      getAbstractFileByPath: jest.fn(),
      createFolder: jest.fn(),
      create: jest.fn(),
      read: jest.fn(async () => {
        // Default: return content that matches the legacy prompt
        const settings = settingsModel.getSettings() as { userSystemPrompt?: string };
        const legacyPrompt = settings?.userSystemPrompt ?? "";
        return `---\ntest: true\n---\n${legacyPrompt}`;
      }),
    } as unknown as Vault;

    // Mock global app
    originalApp = global.app;
    global.app = {
      vault: mockVault,
    } as any;
  });

  afterEach(() => {
    global.app = originalApp;
  });

  it("skips migration when userSystemPrompt is empty", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "",
    });

    await migrateSystemPromptsFromSettings(mockVault);

    expect(logger.logInfo).toHaveBeenCalledWith("No legacy userSystemPrompt to migrate");
    expect(mockVault.create).not.toHaveBeenCalled();
  });

  it("skips migration when userSystemPrompt is whitespace only", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "   ",
    });

    await migrateSystemPromptsFromSettings(mockVault);

    expect(logger.logInfo).toHaveBeenCalledWith("No legacy userSystemPrompt to migrate");
    expect(mockVault.create).not.toHaveBeenCalled();
  });

  it("creates system prompts folder if it does not exist", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "This is a legacy system prompt.",
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist
      .mockReturnValueOnce({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile); // File created

    await migrateSystemPromptsFromSettings(mockVault);

    expect(utils.ensureFolderExists).toHaveBeenCalledWith("SystemPrompts");
  });

  it("does not create folder if it already exists", async () => {
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: "This is a legacy system prompt.",
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist
      .mockReturnValueOnce({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile); // File created

    await migrateSystemPromptsFromSettings(mockVault);

    // ensureFolderExists is always called, but it handles existing folders gracefully
    expect(utils.ensureFolderExists).toHaveBeenCalledWith("SystemPrompts");
  });

  it("migrates legacy prompt to file with correct content", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist
      .mockReturnValueOnce({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile); // File created

    await migrateSystemPromptsFromSettings(mockVault);

    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt.md",
      legacyPrompt
    );
  });

  it("preserves whitespace from legacy prompt content", async () => {
    const legacyPrompt = "  This is a legacy system prompt.  \n\n";
    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile);

    await migrateSystemPromptsFromSettings(mockVault);

    // Whitespace should be preserved (only line endings normalized)
    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt.md",
      "  This is a legacy system prompt.  \n\n"
    );
  });

  it("adds frontmatter to migrated file", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist check
      .mockReturnValueOnce(mockFile); // File retrieved after creation

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(mockVault);

    expect(systemPromptUtils.ensurePromptFrontmatter).toHaveBeenCalledWith(
      mockFile,
      expect.objectContaining({
        title: "Migrated Custom System Prompt",
        content: legacyPrompt,
      })
    );
  });

  it("clears legacy userSystemPrompt from settings after migration", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist check
      .mockReturnValueOnce(mockFile); // File retrieved after creation

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(mockVault);

    expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
  });

  it("sets migrated prompt as default", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist check
      .mockReturnValueOnce(mockFile); // File retrieved after creation

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(mockVault);

    expect(settingsModel.updateSetting).toHaveBeenCalledWith(
      "defaultSystemPromptTitle",
      "Migrated Custom System Prompt"
    );
  });

  it("reloads all prompts after migration", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist check
      .mockReturnValueOnce(mockFile); // File retrieved after creation

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(mockVault);

    expect(systemPromptUtils.loadAllSystemPrompts).toHaveBeenCalled();
  });

  it("generates unique name when default file already exists", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const existingFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;
    const newFile = {
      path: "SystemPrompts/Migrated Custom System Prompt 2.md",
    } as TFile;

    Object.setPrototypeOf(newFile, TFile.prototype);

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    // First call: check default name - exists
    // Second call: check "...Prompt 2" - doesn't exist
    // Third call: get file after creation
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(existingFile) // Default name exists
      .mockReturnValueOnce(null) // "...Prompt 2" doesn't exist
      .mockReturnValueOnce(newFile); // File created

    await migrateSystemPromptsFromSettings(mockVault);

    // Should create file with unique name
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
    const newFile = {
      path: "SystemPrompts/Migrated Custom System Prompt 3.md",
    } as TFile;

    Object.setPrototypeOf(newFile, TFile.prototype);

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });

    // Simulate: default, "2", and "3" checks, then file creation
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce({ path: "exists" }) // Default exists
      .mockReturnValueOnce({ path: "exists" }) // "...Prompt 2" exists
      .mockReturnValueOnce(null) // "...Prompt 3" doesn't exist
      .mockReturnValueOnce(newFile); // File created

    await migrateSystemPromptsFromSettings(mockVault);

    expect(mockVault.create).toHaveBeenCalledWith(
      "SystemPrompts/Migrated Custom System Prompt 3.md",
      legacyPrompt
    );
  });

  it("logs clearing message after migration", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist check
      .mockReturnValueOnce(mockFile); // File retrieved after creation

    Object.setPrototypeOf(mockFile, TFile.prototype);

    await migrateSystemPromptsFromSettings(mockVault);

    expect(logger.logInfo).toHaveBeenCalledWith("Cleared legacy userSystemPrompt field");
  });

  it("handles errors gracefully and preserves data when unsupported save fails", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const error = new Error("Vault error");

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
    // Fail on initial folder creation and unsupported folder creation
    (utils.ensureFolderExists as jest.Mock).mockRejectedValue(error);

    await migrateSystemPromptsFromSettings(mockVault);

    expect(logger.logError).toHaveBeenCalledWith(
      "Failed to migrate legacy userSystemPrompt:",
      error
    );
    // Should NOT clear userSystemPrompt when all save attempts fail
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

    await expect(migrateSystemPromptsFromSettings(mockVault)).resolves.not.toThrow();
  });

  it("sets correct timestamps for migrated prompt", async () => {
    const legacyPrompt = "This is a legacy system prompt.";
    const mockFile = {
      path: "SystemPrompts/Migrated Custom System Prompt.md",
    } as TFile;

    (settingsModel.getSettings as jest.Mock).mockReturnValue({
      userSystemPrompt: legacyPrompt,
    });
    (mockVault.getAbstractFileByPath as jest.Mock)
      .mockReturnValueOnce(null) // File does not exist check
      .mockReturnValueOnce(mockFile); // File retrieved after creation

    Object.setPrototypeOf(mockFile, TFile.prototype);

    const beforeTime = Date.now();
    await migrateSystemPromptsFromSettings(mockVault);
    const afterTime = Date.now();

    expect(systemPromptUtils.ensurePromptFrontmatter).toHaveBeenCalledWith(
      mockFile,
      expect.objectContaining({
        title: "Migrated Custom System Prompt",
        content: legacyPrompt,
        lastUsedMs: 0,
      })
    );

    const callArgs = (systemPromptUtils.ensurePromptFrontmatter as jest.Mock).mock.calls[0][1];
    expect(callArgs.createdMs).toBeGreaterThanOrEqual(beforeTime);
    expect(callArgs.createdMs).toBeLessThanOrEqual(afterTime);
    expect(callArgs.modifiedMs).toBeGreaterThanOrEqual(beforeTime);
    expect(callArgs.modifiedMs).toBeLessThanOrEqual(afterTime);
  });

  // Write-then-verify tests
  describe("write-then-verify safety with unsupported folder", () => {
    it("clears userSystemPrompt and saves to unsupported when verification fails", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = {
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile;

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(mockFile) // File retrieved after creation
        .mockReturnValueOnce(null); // unsupported file does not exist

      // Simulate content mismatch - vault.read returns different content
      (mockVault.read as jest.Mock).mockResolvedValueOnce(
        `---\ntest: true\n---\nDifferent content that does not match!`
      );

      await migrateSystemPromptsFromSettings(mockVault);

      // Should save to unsupported folder
      expect(mockVault.create).toHaveBeenCalledWith(
        "SystemPrompts/unsupported/Migrated System Prompt (Failed Verification).md",
        expect.stringContaining("Migration failed: content verification mismatch")
      );

      // Should clear userSystemPrompt even when verification fails (follows command pattern)
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("preserves userSystemPrompt when all save attempts fail", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const error = new Error("Disk full");

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

      // Mock both vault.create calls to fail (main migration + unsupported save)
      (mockVault.create as jest.Mock)
        .mockRejectedValueOnce(error) // First call fails (main migration)
        .mockRejectedValueOnce(error); // Second call fails (unsupported save)

      await migrateSystemPromptsFromSettings(mockVault);

      // Should NOT clear userSystemPrompt when all save attempts fail
      expect(settingsModel.updateSetting).not.toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("saves to unsupported and clears userSystemPrompt when vault.read throws", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = {
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile;

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(mockFile) // File retrieved after creation
        .mockReturnValueOnce(null); // unsupported file does not exist

      // Simulate vault.read throwing an error during verification
      (mockVault.read as jest.Mock).mockRejectedValueOnce(new Error("Failed to read file"));

      await migrateSystemPromptsFromSettings(mockVault);

      // Should save to unsupported folder
      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("unsupported/"),
        expect.any(String)
      );

      // Should clear userSystemPrompt when saved to unsupported successfully
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("clears userSystemPrompt when main migration fails but unsupported save succeeds", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const error = new Error("Vault error");

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      // Main migration will fail
      (utils.ensureFolderExists as jest.Mock)
        .mockRejectedValueOnce(error) // First call fails (main migration)
        .mockResolvedValueOnce(undefined); // Second call succeeds (unsupported folder)
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(null); // unsupported file does not exist

      await migrateSystemPromptsFromSettings(mockVault);

      // Should save to unsupported folder
      expect(mockVault.create).toHaveBeenCalledWith(
        expect.stringContaining("unsupported/"),
        expect.stringContaining("Migration failed")
      );

      // Should clear userSystemPrompt after saving to unsupported
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("clears userSystemPrompt and sets default on successful verification", async () => {
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = {
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile;

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(mockFile); // File retrieved after creation

      // Default vault.read mock will return content matching legacyPrompt

      await migrateSystemPromptsFromSettings(mockVault);

      // Should clear userSystemPrompt after successful verification
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
      expect(settingsModel.updateSetting).toHaveBeenCalledWith(
        "defaultSystemPromptTitle",
        "Migrated Custom System Prompt"
      );
    });

    it("preserves whitespace and verifies exact content match", async () => {
      const legacyPrompt = "  This is a legacy system prompt.  \n\n";
      const mockFile = {
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile;

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(mockFile); // File retrieved after creation

      // Default vault.read mock will return content matching legacyPrompt (whitespace preserved)

      await migrateSystemPromptsFromSettings(mockVault);

      // Should succeed - whitespace is preserved exactly
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("normalizes CRLF/LF differences in verification", async () => {
      // Legacy prompt uses CRLF line endings (Windows style)
      const legacyPrompt = "Line 1\r\nLine 2\r\nLine 3";
      const mockFile = {
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile;

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(mockFile); // File retrieved after creation

      // Saved content uses LF (Unix style) - file system normalized line endings
      (mockVault.read as jest.Mock).mockResolvedValueOnce(
        `---\ntest: true\n---\nLine 1\nLine 2\nLine 3`
      );

      await migrateSystemPromptsFromSettings(mockVault);

      // Should succeed - CRLF/LF differences are normalized
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
    });

    it("handles double newline after frontmatter (Obsidian format)", async () => {
      // Obsidian's processFrontMatter may add an extra blank line after frontmatter
      const legacyPrompt = "This is a legacy system prompt.";
      const mockFile = {
        path: "SystemPrompts/Migrated Custom System Prompt.md",
      } as TFile;

      Object.setPrototypeOf(mockFile, TFile.prototype);

      (settingsModel.getSettings as jest.Mock).mockReturnValue({
        userSystemPrompt: legacyPrompt,
      });
      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(null) // File does not exist check
        .mockReturnValueOnce(mockFile); // File retrieved after creation

      // Simulate Obsidian adding double newline after frontmatter
      // stripFrontmatter({ trimStart: false }) only removes one newline,
      // but we now strip leading newlines before comparison
      (mockVault.read as jest.Mock).mockResolvedValueOnce(
        `---\ntest: true\n---\n\n${legacyPrompt}`
      );

      await migrateSystemPromptsFromSettings(mockVault);

      // Should succeed - leading newlines are now stripped before comparison
      expect(settingsModel.updateSetting).toHaveBeenCalledWith("userSystemPrompt", "");
      expect(settingsModel.updateSetting).toHaveBeenCalledWith(
        "defaultSystemPromptTitle",
        "Migrated Custom System Prompt"
      );
    });
  });
});
