import { SystemPromptManager } from "@/system-prompts/systemPromptManager";
import { UserSystemPrompt } from "@/system-prompts/type";
import { TFile, Vault } from "obsidian";
import * as systemPromptUtils from "@/system-prompts/systemPromptUtils";
import * as state from "@/system-prompts/state";
import * as utils from "@/utils";

// Mock Obsidian
jest.mock("obsidian", () => ({
  TFile: jest.fn(),
  Vault: jest.fn(),
}));

// Mock logger
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

// Mock utils
jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

// Mock system prompt utils
jest.mock("@/system-prompts/systemPromptUtils", () => ({
  validatePromptName: jest.fn(),
  getPromptFilePath: jest.fn(),
  getSystemPromptsFolder: jest.fn(() => "SystemPrompts"),
  loadAllSystemPrompts: jest.fn(),
  ensurePromptFrontmatter: jest.fn(),
  generateCopyPromptName: jest.fn(),
}));

// Mock state management
jest.mock("@/system-prompts/state", () => ({
  getCachedSystemPrompts: jest.fn(() => []),
  upsertCachedSystemPrompt: jest.fn(),
  deleteCachedSystemPrompt: jest.fn(),
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
}));

describe("SystemPromptManager", () => {
  let manager: SystemPromptManager;
  let mockVault: Vault;
  let originalApp: any;

  beforeEach(() => {
    // Reset the singleton instance before each test
    (SystemPromptManager as any).instance = undefined;

    // Clear all mocks
    jest.clearAllMocks();

    // Create mock vault
    mockVault = {
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      getAbstractFileByPath: jest.fn(),
    } as unknown as Vault;

    // Mock global app
    originalApp = global.app;
    global.app = {
      vault: mockVault,
      fileManager: {
        processFrontMatter: jest.fn(),
        renameFile: jest.fn(),
      },
    } as any;

    // Initialize manager
    manager = SystemPromptManager.getInstance(mockVault);
  });

  afterEach(() => {
    global.app = originalApp;
  });

  describe("getInstance", () => {
    it("returns singleton instance", () => {
      const instance1 = SystemPromptManager.getInstance();
      const instance2 = SystemPromptManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("throws error if vault not provided on first call", () => {
      (SystemPromptManager as any).instance = undefined;
      expect(() => SystemPromptManager.getInstance()).toThrow(
        "Vault is required for first initialization"
      );
    });

    it("does not require vault on subsequent calls", () => {
      const instance1 = SystemPromptManager.getInstance(mockVault);
      const instance2 = SystemPromptManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("initialize", () => {
    it("loads all system prompts", async () => {
      await manager.initialize();
      expect(systemPromptUtils.loadAllSystemPrompts).toHaveBeenCalled();
    });
  });

  describe("createPrompt", () => {
    const newPrompt: UserSystemPrompt = {
      title: "New Prompt",
      content: "Test content",
      createdMs: Date.now(),
      modifiedMs: Date.now(),
      lastUsedMs: 0,
    };

    beforeEach(() => {
      (systemPromptUtils.validatePromptName as jest.Mock).mockReturnValue(null);
      (systemPromptUtils.getPromptFilePath as jest.Mock).mockReturnValue(
        "SystemPrompts/New Prompt.md"
      );
      (state.getCachedSystemPrompts as jest.Mock).mockReturnValue([]);
    });

    it("creates a new prompt file", async () => {
      const mockFile = { path: "SystemPrompts/New Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.createPrompt(newPrompt);

      expect(utils.ensureFolderExists).toHaveBeenCalledWith("SystemPrompts");
      expect(mockVault.create).toHaveBeenCalledWith("SystemPrompts/New Prompt.md", "Test content");
      expect(systemPromptUtils.ensurePromptFrontmatter).toHaveBeenCalledWith(mockFile, newPrompt);
    });

    it("updates cache after creation", async () => {
      const mockFile = { path: "SystemPrompts/New Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.createPrompt(newPrompt);

      expect(state.upsertCachedSystemPrompt).toHaveBeenCalledWith(newPrompt);
    });

    it("skips cache update when skipStoreUpdate is true", async () => {
      const mockFile = { path: "SystemPrompts/New Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.createPrompt(newPrompt, true);

      expect(state.upsertCachedSystemPrompt).not.toHaveBeenCalled();
    });

    it("throws error for duplicate name", async () => {
      (systemPromptUtils.validatePromptName as jest.Mock).mockReturnValue(
        "A prompt with this name already exists"
      );

      await expect(manager.createPrompt(newPrompt)).rejects.toThrow(
        "A prompt with this name already exists"
      );
    });

    it("throws error for invalid name", async () => {
      (systemPromptUtils.validatePromptName as jest.Mock).mockReturnValue(
        "Prompt name contains invalid characters"
      );

      await expect(manager.createPrompt(newPrompt)).rejects.toThrow(
        "Prompt name contains invalid characters"
      );
    });

    it("manages pending file writes", async () => {
      const mockFile = { path: "SystemPrompts/New Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.createPrompt(newPrompt);

      expect(state.addPendingFileWrite).toHaveBeenCalledWith("SystemPrompts/New Prompt.md");
      expect(state.removePendingFileWrite).toHaveBeenCalledWith("SystemPrompts/New Prompt.md");
    });
  });

  describe("updatePrompt", () => {
    const updatedPrompt: UserSystemPrompt = {
      title: "Updated Prompt",
      content: "Updated content",
      createdMs: 1234567890,
      modifiedMs: Date.now(),
      lastUsedMs: 0,
    };

    beforeEach(() => {
      (systemPromptUtils.getPromptFilePath as jest.Mock).mockImplementation(
        (title: string) => `SystemPrompts/${title}.md`
      );
    });

    it("updates prompt content without renaming", async () => {
      const mockFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.updatePrompt("Updated Prompt", updatedPrompt);

      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, "Updated content");
      expect(app.fileManager.processFrontMatter).toHaveBeenCalled();
    });

    it("renames file when title changes", async () => {
      const oldFile = { path: "SystemPrompts/Old Prompt.md" } as TFile;
      const newFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(oldFile, TFile.prototype);
      Object.setPrototypeOf(newFile, TFile.prototype);

      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(oldFile)
        .mockReturnValueOnce(newFile);

      await manager.updatePrompt("Old Prompt", updatedPrompt);

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(
        oldFile,
        "SystemPrompts/Updated Prompt.md"
      );
      expect(mockVault.modify).toHaveBeenCalledWith(newFile, "Updated content");
    });

    it("updates cache after modification", async () => {
      const mockFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.updatePrompt("Updated Prompt", updatedPrompt);

      expect(state.upsertCachedSystemPrompt).toHaveBeenCalledWith(updatedPrompt);
    });

    it("deletes old cache entry when renaming", async () => {
      const oldFile = { path: "SystemPrompts/Old Prompt.md" } as TFile;
      const newFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(oldFile, TFile.prototype);
      Object.setPrototypeOf(newFile, TFile.prototype);

      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(oldFile)
        .mockReturnValueOnce(newFile);

      await manager.updatePrompt("Old Prompt", updatedPrompt);

      expect(state.deleteCachedSystemPrompt).toHaveBeenCalledWith("Old Prompt");
      expect(state.upsertCachedSystemPrompt).toHaveBeenCalledWith(updatedPrompt);
    });

    it("skips cache update when skipStoreUpdate is true", async () => {
      const mockFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.updatePrompt("Updated Prompt", updatedPrompt, true);

      expect(state.upsertCachedSystemPrompt).not.toHaveBeenCalled();
    });

    it("manages pending file writes for update", async () => {
      const mockFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.updatePrompt("Updated Prompt", updatedPrompt);

      expect(state.addPendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Updated Prompt.md");
      expect(state.removePendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Updated Prompt.md");
    });

    it("manages pending file writes for rename", async () => {
      const oldFile = { path: "SystemPrompts/Old Prompt.md" } as TFile;
      const newFile = { path: "SystemPrompts/Updated Prompt.md" } as TFile;
      Object.setPrototypeOf(oldFile, TFile.prototype);
      Object.setPrototypeOf(newFile, TFile.prototype);

      (mockVault.getAbstractFileByPath as jest.Mock)
        .mockReturnValueOnce(oldFile)
        .mockReturnValueOnce(newFile);

      await manager.updatePrompt("Old Prompt", updatedPrompt);

      expect(state.addPendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Updated Prompt.md");
      expect(state.addPendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Old Prompt.md");
      expect(state.removePendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Updated Prompt.md");
      expect(state.removePendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Old Prompt.md");
    });
  });

  describe("deletePrompt", () => {
    beforeEach(() => {
      (systemPromptUtils.getPromptFilePath as jest.Mock).mockReturnValue(
        "SystemPrompts/Test Prompt.md"
      );
    });

    it("deletes the prompt file", async () => {
      const mockFile = { path: "SystemPrompts/Test Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.deletePrompt("Test Prompt");

      expect(mockVault.delete).toHaveBeenCalledWith(mockFile);
    });

    it("removes prompt from cache", async () => {
      const mockFile = { path: "SystemPrompts/Test Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.deletePrompt("Test Prompt");

      expect(state.deleteCachedSystemPrompt).toHaveBeenCalledWith("Test Prompt");
    });

    it("handles non-existent file gracefully", async () => {
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);

      await manager.deletePrompt("Non-existent Prompt");

      expect(mockVault.delete).not.toHaveBeenCalled();
      expect(state.deleteCachedSystemPrompt).toHaveBeenCalledWith("Non-existent Prompt");
    });

    it("manages pending file writes", async () => {
      const mockFile = { path: "SystemPrompts/Test Prompt.md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.deletePrompt("Test Prompt");

      expect(state.addPendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Test Prompt.md");
      expect(state.removePendingFileWrite).toHaveBeenCalledWith("SystemPrompts/Test Prompt.md");
    });
  });

  describe("duplicatePrompt", () => {
    const originalPrompt: UserSystemPrompt = {
      title: "Original Prompt",
      content: "Original content",
      createdMs: 1234567890,
      modifiedMs: 1234567891,
      lastUsedMs: 1234567892,
    };

    beforeEach(() => {
      (systemPromptUtils.generateCopyPromptName as jest.Mock).mockReturnValue(
        "Original Prompt (copy)"
      );
      (systemPromptUtils.validatePromptName as jest.Mock).mockReturnValue(null);
      (systemPromptUtils.getPromptFilePath as jest.Mock).mockReturnValue(
        "SystemPrompts/Original Prompt (copy).md"
      );
      (state.getCachedSystemPrompts as jest.Mock).mockReturnValue([originalPrompt]);
    });

    it("creates a duplicate with (copy) suffix", async () => {
      const mockFile = { path: "SystemPrompts/Original Prompt (copy).md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      const result = await manager.duplicatePrompt(originalPrompt);

      expect(systemPromptUtils.generateCopyPromptName).toHaveBeenCalledWith("Original Prompt", [
        originalPrompt,
      ]);
      expect(result.title).toBe("Original Prompt (copy)");
      expect(result.content).toBe("Original content");
    });

    it("sets new timestamps for duplicated prompt", async () => {
      const mockFile = { path: "SystemPrompts/Original Prompt (copy).md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      const beforeTime = Date.now();
      const result = await manager.duplicatePrompt(originalPrompt);
      const afterTime = Date.now();

      expect(result.createdMs).toBeGreaterThanOrEqual(beforeTime);
      expect(result.createdMs).toBeLessThanOrEqual(afterTime);
      expect(result.modifiedMs).toBeGreaterThanOrEqual(beforeTime);
      expect(result.modifiedMs).toBeLessThanOrEqual(afterTime);
      expect(result.lastUsedMs).toBe(0);
    });

    it("creates the duplicated file", async () => {
      const mockFile = { path: "SystemPrompts/Original Prompt (copy).md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      await manager.duplicatePrompt(originalPrompt);

      expect(mockVault.create).toHaveBeenCalledWith(
        "SystemPrompts/Original Prompt (copy).md",
        "Original content"
      );
    });

    it("returns the duplicated prompt object", async () => {
      const mockFile = { path: "SystemPrompts/Original Prompt (copy).md" } as TFile;
      Object.setPrototypeOf(mockFile, TFile.prototype);
      (mockVault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

      const result = await manager.duplicatePrompt(originalPrompt);

      expect(result).toMatchObject({
        title: "Original Prompt (copy)",
        content: "Original content",
        lastUsedMs: 0,
      });
      expect(result.createdMs).toBeGreaterThan(0);
      expect(result.modifiedMs).toBeGreaterThan(0);
    });
  });

  describe("getPrompts", () => {
    it("returns cached prompts", () => {
      const mockPrompts: UserSystemPrompt[] = [
        {
          title: "Prompt 1",
          content: "Content 1",
          createdMs: 0,
          modifiedMs: 0,
          lastUsedMs: 0,
        },
        {
          title: "Prompt 2",
          content: "Content 2",
          createdMs: 0,
          modifiedMs: 0,
          lastUsedMs: 0,
        },
      ];

      (state.getCachedSystemPrompts as jest.Mock).mockReturnValue(mockPrompts);

      const result = manager.getPrompts();

      expect(result).toEqual(mockPrompts);
      expect(state.getCachedSystemPrompts).toHaveBeenCalled();
    });
  });

  describe("reloadPrompts", () => {
    it("reloads all prompts from file system", async () => {
      const mockPrompts: UserSystemPrompt[] = [
        {
          title: "Prompt 1",
          content: "Content 1",
          createdMs: 0,
          modifiedMs: 0,
          lastUsedMs: 0,
        },
      ];

      (systemPromptUtils.loadAllSystemPrompts as jest.Mock).mockResolvedValue(mockPrompts);

      const result = await manager.reloadPrompts();

      expect(systemPromptUtils.loadAllSystemPrompts).toHaveBeenCalled();
      expect(result).toEqual(mockPrompts);
    });
  });
});
