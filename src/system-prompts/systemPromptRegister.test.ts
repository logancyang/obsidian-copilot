import { Notice, Plugin, TFile, Vault } from "obsidian";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import * as state from "@/system-prompts/state";
import * as systemPromptUtils from "@/system-prompts/systemPromptUtils";

// Mock obsidian
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Plugin: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
}));

// Mock logger
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

// Mock state module
jest.mock("@/system-prompts/state", () => ({
  isPendingFileWrite: jest.fn().mockReturnValue(false),
  initializeSessionPromptFromDefault: jest.fn(),
  upsertCachedSystemPrompt: jest.fn(),
  deleteCachedSystemPrompt: jest.fn(),
  updateCachedSystemPrompts: jest.fn(),
  getSelectedPromptTitle: jest.fn().mockReturnValue(""),
  setSelectedPromptTitle: jest.fn(),
}));

// Mock systemPromptUtils
jest.mock("@/system-prompts/systemPromptUtils", () => ({
  isSystemPromptFile: jest.fn().mockReturnValue(true),
  getSystemPromptsFolder: jest.fn().mockReturnValue("SystemPrompts"),
  parseSystemPromptFile: jest.fn().mockResolvedValue({
    title: "Test Prompt",
    content: "Test content",
    createdMs: 1000,
    modifiedMs: 1000,
    lastUsedMs: 0,
  }),
  ensurePromptFrontmatter: jest.fn().mockResolvedValue(undefined),
}));

// Mock settings
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({
    defaultSystemPromptTitle: "",
    userSystemPromptsFolder: "SystemPrompts",
  }),
  updateSetting: jest.fn(),
  subscribeToSettingsChange: jest.fn().mockReturnValue(() => {}),
}));

// Mock SystemPromptManager
jest.mock("@/system-prompts/systemPromptManager", () => ({
  SystemPromptManager: {
    getInstance: jest.fn().mockReturnValue({
      initialize: jest.fn().mockResolvedValue(undefined),
      reloadPrompts: jest.fn().mockResolvedValue([]),
      fetchPrompts: jest.fn().mockResolvedValue([]),
    }),
  },
}));

describe("SystemPromptRegister", () => {
  let mockPlugin: Plugin;
  let mockVault: Vault;
  let register: SystemPromptRegister;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vaultEventHandlers: Record<string, (...args: any[]) => void>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Capture vault event handlers
    vaultEventHandlers = {};

    mockPlugin = {} as Plugin;
    mockVault = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        vaultEventHandlers[event] = handler;
      }),
      off: jest.fn(),
    } as unknown as Vault;

    register = new SystemPromptRegister(mockPlugin, mockVault);
  });

  afterEach(() => {
    register.cleanup();
  });

  describe("handleFileDeletion - selectedPromptTitle sync", () => {
    it("clears selectedPromptTitle when deleted file matches current selection", async () => {
      const mockFile = {
        path: "SystemPrompts/MyPrompt.md",
        basename: "MyPrompt",
        extension: "md",
      } as TFile;

      // Set up: current selection points to the file being deleted
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("MyPrompt");

      // Trigger the delete handler
      await vaultEventHandlers["delete"](mockFile);

      // Verify selectedPromptTitle was cleared
      expect(state.setSelectedPromptTitle).toHaveBeenCalledWith("");
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("MyPrompt"));
    });

    it("does not clear selectedPromptTitle when deleted file does not match", async () => {
      const mockFile = {
        path: "SystemPrompts/OtherPrompt.md",
        basename: "OtherPrompt",
        extension: "md",
      } as TFile;

      // Set up: current selection points to a different prompt
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("MyPrompt");

      // Trigger the delete handler
      await vaultEventHandlers["delete"](mockFile);

      // Verify selectedPromptTitle was NOT changed
      expect(state.setSelectedPromptTitle).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("does not clear selectedPromptTitle when no prompt is selected", async () => {
      const mockFile = {
        path: "SystemPrompts/MyPrompt.md",
        basename: "MyPrompt",
        extension: "md",
      } as TFile;

      // Set up: no prompt is currently selected
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("");

      // Trigger the delete handler
      await vaultEventHandlers["delete"](mockFile);

      // Verify selectedPromptTitle was NOT changed
      expect(state.setSelectedPromptTitle).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });
  });

  describe("handleFileRename - selectedPromptTitle sync", () => {
    it("updates selectedPromptTitle when renamed file matches current selection", async () => {
      const mockFile = {
        path: "SystemPrompts/NewName.md",
        basename: "NewName",
        extension: "md",
      } as TFile;
      const oldPath = "SystemPrompts/OldName.md";

      // Set up: current selection points to the old name
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("OldName");
      (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(true);

      // Trigger the rename handler
      await vaultEventHandlers["rename"](mockFile, oldPath);

      // Verify selectedPromptTitle was updated to new name
      expect(state.setSelectedPromptTitle).toHaveBeenCalledWith("NewName");
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("renamed"));
    });

    it("clears selectedPromptTitle when file is moved out of prompts folder", async () => {
      const mockFile = {
        path: "OtherFolder/MyPrompt.md",
        basename: "MyPrompt",
        extension: "md",
      } as TFile;
      const oldPath = "SystemPrompts/MyPrompt.md";

      // Set up: current selection points to the moved file
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("MyPrompt");
      // File is no longer a valid system prompt file (moved out)
      (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(false);

      // Trigger the rename handler
      await vaultEventHandlers["rename"](mockFile, oldPath);

      // Verify selectedPromptTitle was cleared
      expect(state.setSelectedPromptTitle).toHaveBeenCalledWith("");
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("moved out"));
    });

    it("does not update selectedPromptTitle when renamed file does not match", async () => {
      const mockFile = {
        path: "SystemPrompts/NewName.md",
        basename: "NewName",
        extension: "md",
      } as TFile;
      const oldPath = "SystemPrompts/OldName.md";

      // Set up: current selection points to a different prompt
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("OtherPrompt");
      (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(true);

      // Trigger the rename handler
      await vaultEventHandlers["rename"](mockFile, oldPath);

      // Verify selectedPromptTitle was NOT changed
      expect(state.setSelectedPromptTitle).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });

    it("does not update selectedPromptTitle when no prompt is selected", async () => {
      const mockFile = {
        path: "SystemPrompts/NewName.md",
        basename: "NewName",
        extension: "md",
      } as TFile;
      const oldPath = "SystemPrompts/OldName.md";

      // Set up: no prompt is currently selected
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("");
      (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(true);

      // Trigger the rename handler
      await vaultEventHandlers["rename"](mockFile, oldPath);

      // Verify selectedPromptTitle was NOT changed
      expect(state.setSelectedPromptTitle).not.toHaveBeenCalled();
      expect(Notice).not.toHaveBeenCalled();
    });
  });

  describe("handleSystemPromptsFolderChange - validation", () => {
    let settingsChangeHandler: (prev: unknown, next: unknown) => void;
    let mockManager: { fetchPrompts: jest.Mock };

    beforeEach(() => {
      jest.useFakeTimers();

      // Capture the settings change handler
      const { subscribeToSettingsChange } = jest.requireMock("@/settings/model");
      settingsChangeHandler = subscribeToSettingsChange.mock.calls[0]?.[0];

      // Get reference to mock manager
      const { SystemPromptManager } = jest.requireMock("@/system-prompts/systemPromptManager");
      mockManager = SystemPromptManager.getInstance();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("clears selectedPromptTitle when prompt not found in new folder", async () => {
      // Set up: current selection points to a prompt that won't exist in new folder
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("OldPrompt");

      // Mock fetchPrompts to return prompts that don't include "OldPrompt"
      mockManager.fetchPrompts.mockResolvedValueOnce([
        { title: "NewPrompt1", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
        { title: "NewPrompt2", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
      ]);

      // Trigger folder change
      settingsChangeHandler(
        { userSystemPromptsFolder: "OldFolder" },
        { userSystemPromptsFolder: "NewFolder" }
      );

      // Fast-forward debounce timer
      jest.advanceTimersByTime(300);

      // Wait for async operations
      await Promise.resolve();
      await Promise.resolve();

      // Verify selectedPromptTitle was cleared
      expect(state.setSelectedPromptTitle).toHaveBeenCalledWith("");
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("OldPrompt"));
    });

    it("clears defaultSystemPromptTitle when prompt not found in new folder", async () => {
      const { getSettings, updateSetting } = jest.requireMock("@/settings/model");

      // Set up: default prompt points to a prompt that won't exist in new folder
      (getSettings as jest.Mock).mockReturnValue({
        defaultSystemPromptTitle: "OldDefault",
        userSystemPromptsFolder: "NewFolder",
      });
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("");

      // Mock fetchPrompts to return prompts that don't include "OldDefault"
      mockManager.fetchPrompts.mockResolvedValueOnce([
        { title: "NewPrompt1", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
      ]);

      // Trigger folder change
      settingsChangeHandler(
        { userSystemPromptsFolder: "OldFolder" },
        { userSystemPromptsFolder: "NewFolder" }
      );

      // Fast-forward debounce timer
      jest.advanceTimersByTime(300);

      // Wait for async operations
      await Promise.resolve();
      await Promise.resolve();

      // Verify defaultSystemPromptTitle was cleared
      expect(updateSetting).toHaveBeenCalledWith("defaultSystemPromptTitle", "");
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("OldDefault"));
    });

    it("does not clear prompts when they exist in new folder", async () => {
      const { getSettings, updateSetting } = jest.requireMock("@/settings/model");

      // Set up: prompts exist in new folder
      (getSettings as jest.Mock).mockReturnValue({
        defaultSystemPromptTitle: "ExistingPrompt",
        userSystemPromptsFolder: "NewFolder",
      });
      (state.getSelectedPromptTitle as jest.Mock).mockReturnValue("ExistingPrompt");

      // Mock fetchPrompts to return prompts that include "ExistingPrompt"
      mockManager.fetchPrompts.mockResolvedValueOnce([
        { title: "ExistingPrompt", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
      ]);

      // Trigger folder change
      settingsChangeHandler(
        { userSystemPromptsFolder: "OldFolder" },
        { userSystemPromptsFolder: "NewFolder" }
      );

      // Fast-forward debounce timer
      jest.advanceTimersByTime(300);

      // Wait for async operations
      await Promise.resolve();
      await Promise.resolve();

      // Verify nothing was cleared
      expect(state.setSelectedPromptTitle).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalledWith("defaultSystemPromptTitle", "");
      expect(Notice).not.toHaveBeenCalled();
    });

    it("debounces rapid folder changes", async () => {
      // Trigger multiple rapid folder changes
      settingsChangeHandler(
        { userSystemPromptsFolder: "Folder1" },
        { userSystemPromptsFolder: "Folder2" }
      );
      settingsChangeHandler(
        { userSystemPromptsFolder: "Folder2" },
        { userSystemPromptsFolder: "Folder3" }
      );
      settingsChangeHandler(
        { userSystemPromptsFolder: "Folder3" },
        { userSystemPromptsFolder: "Folder4" }
      );

      // Fast-forward debounce timer
      jest.advanceTimersByTime(300);

      // Wait for async operations
      await Promise.resolve();
      await Promise.resolve();

      // Should only fetch once (debounced)
      expect(mockManager.fetchPrompts).toHaveBeenCalledTimes(1);
    });

    it("preserves old cache on reload failure (success-then-replace)", async () => {
      // Mock fetchPrompts to fail
      mockManager.fetchPrompts.mockRejectedValueOnce(new Error("Network error"));

      // Trigger folder change
      settingsChangeHandler(
        { userSystemPromptsFolder: "OldFolder" },
        { userSystemPromptsFolder: "NewFolder" }
      );

      // Fast-forward debounce timer
      jest.advanceTimersByTime(300);

      // Wait for async operations
      await Promise.resolve();
      await Promise.resolve();

      // Cache should NOT be cleared (updateCachedSystemPrompts not called with new prompts)
      // The old cache is preserved on failure
      expect(state.updateCachedSystemPrompts).not.toHaveBeenCalled();
    });

    it("discards stale request results when newer request completes first (latest-wins)", async () => {
      // This test simulates the race condition scenario:
      // 1. Request A starts (folder change to FolderA)
      // 2. Request B starts (folder change to FolderB) - before A completes
      // 3. Request B completes first with promptsB
      // 4. Request A completes later with promptsA
      // Expected: Only promptsB should be applied, promptsA should be discarded

      const promptsA = [
        { title: "PromptA", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
      ];
      const promptsB = [
        { title: "PromptB", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
      ];

      // Create deferred promises to control completion order
      let resolveA: (value: typeof promptsA) => void;
      let resolveB: (value: typeof promptsB) => void;
      const promiseA = new Promise<typeof promptsA>((r) => {
        resolveA = r;
      });
      const promiseB = new Promise<typeof promptsB>((r) => {
        resolveB = r;
      });

      mockManager.fetchPrompts
        .mockReturnValueOnce(promiseA) // First call (request A)
        .mockReturnValueOnce(promiseB); // Second call (request B)

      // Trigger first folder change (request A)
      settingsChangeHandler(
        { userSystemPromptsFolder: "Original" },
        { userSystemPromptsFolder: "FolderA" }
      );
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      // Trigger second folder change (request B) before A completes
      settingsChangeHandler(
        { userSystemPromptsFolder: "FolderA" },
        { userSystemPromptsFolder: "FolderB" }
      );
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      // Request B completes first
      resolveB!(promptsB);
      await Promise.resolve();
      await Promise.resolve();

      // Verify promptsB was applied
      expect(state.updateCachedSystemPrompts).toHaveBeenCalledWith(promptsB);
      (state.updateCachedSystemPrompts as jest.Mock).mockClear();

      // Request A completes later (stale)
      resolveA!(promptsA);
      await Promise.resolve();
      await Promise.resolve();

      // Verify promptsA was NOT applied (discarded as stale)
      expect(state.updateCachedSystemPrompts).not.toHaveBeenCalled();
    });
  });
});
