import { App, Notice, Vault } from "obsidian";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import * as state from "@/system-prompts/state";
import * as systemPromptUtils from "@/system-prompts/systemPromptUtils";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Plugin: jest.fn(),
  TFile: jest.fn(),
  Vault: jest.fn(),
  normalizePath: (path: string) => path,
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

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
  updatePromptDefaultFlag: jest.fn().mockResolvedValue(undefined),
  fetchAllSystemPrompts: jest.fn().mockResolvedValue([]),
  loadAllSystemPrompts: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({
    defaultSystemPromptTitle: "",
    userSystemPromptsFolder: "SystemPrompts",
  }),
  updateSetting: jest.fn(),
  subscribeToSettingsChange: jest.fn().mockReturnValue(() => {}),
}));

function cachedPrompt(title: string) {
  return { title, content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

describe("systemPromptRegister", () => {
  describe("SystemPromptRegister", () => {
    let mockVault: Vault;
    let mockApp: App;
    let register: SystemPromptRegister;

    let vaultEventHandlers: Record<string, (...args: unknown[]) => unknown>;

    beforeEach(() => {
      jest.clearAllMocks();
      state.updateCachedSystemPrompts([]);
      state.setSelectedPromptTitle("");

      vaultEventHandlers = {};

      mockVault = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => unknown) => {
          vaultEventHandlers[event] = handler;
        }),
        off: jest.fn(),
      } as unknown as Vault;

      mockApp = { vault: mockVault } as unknown as App;
      register = new SystemPromptRegister(mockApp);
    });

    afterEach(() => {
      register.cleanup();
    });

    describe("initialize()", () => {
      it("loads saved prompts without selecting the hidden legacy default (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
        await register.initialize();

        expect(systemPromptUtils.loadAllSystemPrompts).toHaveBeenCalledWith(mockApp);
        expect(state.getSelectedPromptTitle()).toBe("");
      });
    });

    describe("when a prompt file is deleted", () => {
      it("clears selectedPromptTitle when deleted file matches current selection", async () => {
        const mockFile = mockTFile({
          path: "SystemPrompts/MyPrompt.md",
          basename: "MyPrompt",
          extension: "md",
        });

        state.setSelectedPromptTitle("MyPrompt");
        state.updateCachedSystemPrompts([cachedPrompt("MyPrompt"), cachedPrompt("Keep")]);

        await vaultEventHandlers["delete"](mockFile);

        expect(state.getSelectedPromptTitle()).toBe("");
        expect(state.getCachedSystemPrompts().map((p) => p.title)).toEqual(["Keep"]);
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("MyPrompt"));
      });

      it("does not clear selectedPromptTitle when deleted file does not match", async () => {
        const mockFile = mockTFile({
          path: "SystemPrompts/OtherPrompt.md",
          basename: "OtherPrompt",
          extension: "md",
        });

        state.setSelectedPromptTitle("MyPrompt");

        await vaultEventHandlers["delete"](mockFile);

        expect(state.getSelectedPromptTitle()).toBe("MyPrompt");
        expect(Notice).not.toHaveBeenCalled();
      });

      it("does not clear selectedPromptTitle when no prompt is selected", async () => {
        const mockFile = mockTFile({
          path: "SystemPrompts/MyPrompt.md",
          basename: "MyPrompt",
          extension: "md",
        });

        await vaultEventHandlers["delete"](mockFile);

        expect(state.getSelectedPromptTitle()).toBe("");
        expect(Notice).not.toHaveBeenCalled();
      });
    });

    describe("when a prompt file is renamed or moved", () => {
      it("updates selectedPromptTitle when renamed file matches current selection", async () => {
        const mockFile = mockTFile({
          path: "SystemPrompts/NewName.md",
          basename: "NewName",
          extension: "md",
        });
        const oldPath = "SystemPrompts/OldName.md";

        state.setSelectedPromptTitle("OldName");
        (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(true);

        await vaultEventHandlers["rename"](mockFile, oldPath);

        expect(state.getSelectedPromptTitle()).toBe("NewName");
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("renamed"));
      });

      it("clears selectedPromptTitle when file is moved out of prompts folder", async () => {
        const mockFile = mockTFile({
          path: "OtherFolder/MyPrompt.md",
          basename: "MyPrompt",
          extension: "md",
        });
        const oldPath = "SystemPrompts/MyPrompt.md";

        state.setSelectedPromptTitle("MyPrompt");
        (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(false);

        await vaultEventHandlers["rename"](mockFile, oldPath);

        expect(state.getSelectedPromptTitle()).toBe("");
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("moved out"));
      });

      it("does not update selectedPromptTitle when renamed file does not match", async () => {
        const mockFile = mockTFile({
          path: "SystemPrompts/NewName.md",
          basename: "NewName",
          extension: "md",
        });
        const oldPath = "SystemPrompts/OldName.md";

        state.setSelectedPromptTitle("OtherPrompt");
        (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(true);

        await vaultEventHandlers["rename"](mockFile, oldPath);

        expect(state.getSelectedPromptTitle()).toBe("OtherPrompt");
        expect(Notice).not.toHaveBeenCalled();
      });

      it("does not update selectedPromptTitle when no prompt is selected", async () => {
        const mockFile = mockTFile({
          path: "SystemPrompts/NewName.md",
          basename: "NewName",
          extension: "md",
        });
        const oldPath = "SystemPrompts/OldName.md";

        (systemPromptUtils.isSystemPromptFile as unknown as jest.Mock).mockReturnValue(true);

        await vaultEventHandlers["rename"](mockFile, oldPath);

        expect(state.getSelectedPromptTitle()).toBe("");
        expect(Notice).not.toHaveBeenCalled();
      });
    });

    describe("when the system prompts folder changes", () => {
      let settingsChangeHandler: (prev: unknown, next: unknown) => void;
      let mockFetchAllSystemPrompts: jest.Mock;

      beforeEach(() => {
        jest.useFakeTimers();

        const { subscribeToSettingsChange } = jest.requireMock<{
          subscribeToSettingsChange: jest.Mock;
        }>("@/settings/model");
        settingsChangeHandler = subscribeToSettingsChange.mock
          .calls[0]?.[0] as typeof settingsChangeHandler;

        mockFetchAllSystemPrompts = systemPromptUtils.fetchAllSystemPrompts as jest.Mock;
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("clears selectedPromptTitle when prompt not found in new folder", async () => {
        state.setSelectedPromptTitle("OldPrompt");

        mockFetchAllSystemPrompts.mockResolvedValueOnce([
          { title: "NewPrompt1", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
          { title: "NewPrompt2", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
        ]);

        settingsChangeHandler({ copilotFolder: "OldFolder" }, { copilotFolder: "NewFolder" });

        jest.advanceTimersByTime(300);

        await Promise.resolve();
        await Promise.resolve();

        expect(state.getSelectedPromptTitle()).toBe("");
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("OldPrompt"));
      });

      it("clears defaultSystemPromptTitle when prompt not found in new folder", async () => {
        const { getSettings, updateSetting } = jest.requireMock<{
          getSettings: jest.Mock;
          updateSetting: jest.Mock;
        }>("@/settings/model");

        getSettings.mockReturnValue({
          defaultSystemPromptTitle: "OldDefault",
          userSystemPromptsFolder: "NewFolder",
        });

        mockFetchAllSystemPrompts.mockResolvedValueOnce([
          { title: "NewPrompt1", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
        ]);

        settingsChangeHandler({ copilotFolder: "OldFolder" }, { copilotFolder: "NewFolder" });

        jest.advanceTimersByTime(300);

        await Promise.resolve();
        await Promise.resolve();

        expect(updateSetting).toHaveBeenCalledWith("defaultSystemPromptTitle", "");
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("OldDefault"));
      });

      it("does not clear prompts when they exist in new folder", async () => {
        const { getSettings, updateSetting } = jest.requireMock<{
          getSettings: jest.Mock;
          updateSetting: jest.Mock;
        }>("@/settings/model");

        getSettings.mockReturnValue({
          defaultSystemPromptTitle: "ExistingPrompt",
          userSystemPromptsFolder: "NewFolder",
        });
        state.setSelectedPromptTitle("ExistingPrompt");

        mockFetchAllSystemPrompts.mockResolvedValueOnce([
          { title: "ExistingPrompt", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
        ]);

        settingsChangeHandler({ copilotFolder: "OldFolder" }, { copilotFolder: "NewFolder" });

        jest.advanceTimersByTime(300);

        await Promise.resolve();
        await Promise.resolve();

        expect(state.getSelectedPromptTitle()).toBe("ExistingPrompt");
        expect(updateSetting).not.toHaveBeenCalledWith("defaultSystemPromptTitle", "");
        expect(Notice).not.toHaveBeenCalled();
      });

      it("passes the OLD derived folder to the default flag update when the root also changes", async () => {
        const { updatePromptDefaultFlag } = jest.requireMock<{
          updatePromptDefaultFlag: jest.Mock;
        }>("@/system-prompts/systemPromptUtils");
        const { getSettings } = jest.requireMock<{ getSettings: jest.Mock }>("@/settings/model");
        getSettings.mockReturnValue({
          defaultSystemPromptTitle: "NewDefault",
          copilotFolder: "team/ai",
        });

        settingsChangeHandler(
          { copilotFolder: "copilot", defaultSystemPromptTitle: "OldDefault" },
          { copilotFolder: "team/ai", defaultSystemPromptTitle: "NewDefault" }
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(updatePromptDefaultFlag).toHaveBeenCalledWith(
          expect.anything(),
          "OldDefault",
          false,
          "copilot/system-prompts"
        );
        expect(updatePromptDefaultFlag).toHaveBeenCalledWith(expect.anything(), "NewDefault", true);
      });

      it("debounces rapid folder changes", async () => {
        settingsChangeHandler({ copilotFolder: "Folder1" }, { copilotFolder: "Folder2" });
        settingsChangeHandler({ copilotFolder: "Folder2" }, { copilotFolder: "Folder3" });
        settingsChangeHandler({ copilotFolder: "Folder3" }, { copilotFolder: "Folder4" });

        jest.advanceTimersByTime(300);

        await Promise.resolve();
        await Promise.resolve();

        expect(mockFetchAllSystemPrompts).toHaveBeenCalledTimes(1);
      });

      it("preserves old cache on reload failure (success-then-replace)", async () => {
        const cached = [cachedPrompt("Cached")];
        state.updateCachedSystemPrompts(cached);
        mockFetchAllSystemPrompts.mockRejectedValueOnce(new Error("Network error"));

        settingsChangeHandler({ copilotFolder: "OldFolder" }, { copilotFolder: "NewFolder" });

        jest.advanceTimersByTime(300);

        await Promise.resolve();
        await Promise.resolve();

        expect(state.getCachedSystemPrompts()).toBe(cached);
      });

      it("discards stale request results when newer request completes first (latest-wins)", async () => {
        const promptsA = [
          { title: "PromptA", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
        ];
        const promptsB = [
          { title: "PromptB", content: "", createdMs: 0, modifiedMs: 0, lastUsedMs: 0 },
        ];

        let resolveA: (value: typeof promptsA) => void;
        let resolveB: (value: typeof promptsB) => void;
        const promiseA = new Promise<typeof promptsA>((r) => {
          resolveA = r;
        });
        const promiseB = new Promise<typeof promptsB>((r) => {
          resolveB = r;
        });

        mockFetchAllSystemPrompts.mockReturnValueOnce(promiseA).mockReturnValueOnce(promiseB);

        settingsChangeHandler({ copilotFolder: "Original" }, { copilotFolder: "FolderA" });
        jest.advanceTimersByTime(300);
        await Promise.resolve();

        settingsChangeHandler({ copilotFolder: "FolderA" }, { copilotFolder: "FolderB" });
        jest.advanceTimersByTime(300);
        await Promise.resolve();

        resolveB!(promptsB);
        await Promise.resolve();
        await Promise.resolve();

        expect(state.getCachedSystemPrompts()).toEqual(promptsB);

        resolveA!(promptsA);
        await Promise.resolve();
        await Promise.resolve();

        expect(state.getCachedSystemPrompts()).toEqual(promptsB);
      });
    });
  });
});
