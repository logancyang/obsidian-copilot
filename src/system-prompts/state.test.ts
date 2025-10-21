import {
  updateCachedSystemPrompts,
  getSelectedPromptTitle,
  setSelectedPromptTitle,
  getDisableBuiltinSystemPrompt,
  setDisableBuiltinSystemPrompt,
  getEffectiveSystemPromptContent,
  resetSessionSystemPromptSettings,
  getDefaultSystemPromptTitle,
  setDefaultSystemPromptTitle,
  initializeSessionPromptFromDefault,
} from "@/system-prompts/state";
import { UserSystemPrompt } from "@/system-prompts/type";
import * as settingsModel from "@/settings/model";

// Mock settings
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    defaultSystemPromptTitle: "",
  })),
  updateSetting: jest.fn(),
}));

describe("System Prompts State Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset state by clearing prompts
    updateCachedSystemPrompts([]);
    setSelectedPromptTitle("");
    setDisableBuiltinSystemPrompt(false);
  });

  describe("getEffectiveSystemPromptContent", () => {
    const mockPrompts: UserSystemPrompt[] = [
      {
        title: "Session Prompt",
        content: "This is session prompt content",
        createdMs: 1000,
        modifiedMs: 1000,
        lastUsedMs: 1000,
      },
      {
        title: "Default Prompt",
        content: "This is default prompt content",
        createdMs: 2000,
        modifiedMs: 2000,
        lastUsedMs: 2000,
      },
      {
        title: "Another Prompt",
        content: "This is another prompt content",
        createdMs: 3000,
        modifiedMs: 3000,
        lastUsedMs: 3000,
      },
    ];

    beforeEach(() => {
      updateCachedSystemPrompts(mockPrompts);
    });

    it("returns session prompt content when session prompt is selected", () => {
      setSelectedPromptTitle("Session Prompt");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Default Prompt",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("This is session prompt content");
    });

    it("returns default prompt content when no session prompt is selected", () => {
      setSelectedPromptTitle("");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Default Prompt",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("This is default prompt content");
    });

    it("returns empty string when neither session nor default prompt is selected", () => {
      setSelectedPromptTitle("");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("");
    });

    it("returns empty string when session prompt title does not exist in cache", () => {
      setSelectedPromptTitle("Non-existent Prompt");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("");
    });

    it("returns empty string when default prompt title does not exist in cache", () => {
      setSelectedPromptTitle("");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Non-existent Default",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("");
    });

    it("prioritizes session prompt over default prompt", () => {
      setSelectedPromptTitle("Session Prompt");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Default Prompt",
      } as any);

      const result = getEffectiveSystemPromptContent();

      // Should return session prompt, not default
      expect(result).toBe("This is session prompt content");
      expect(result).not.toBe("This is default prompt content");
    });

    it("falls back to default when session prompt exists but is not found", () => {
      setSelectedPromptTitle("Non-existent Session");
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Default Prompt",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("This is default prompt content");
    });
  });

  describe("resetSessionSystemPromptSettings", () => {
    it("resets session prompt title to empty string", () => {
      setSelectedPromptTitle("Some Prompt");
      setDisableBuiltinSystemPrompt(true);

      resetSessionSystemPromptSettings();

      expect(getSelectedPromptTitle()).toBe("");
    });

    it("resets disable builtin system prompt to false", () => {
      setSelectedPromptTitle("Some Prompt");
      setDisableBuiltinSystemPrompt(true);

      resetSessionSystemPromptSettings();

      expect(getDisableBuiltinSystemPrompt()).toBe(false);
    });

    it("resets both settings together", () => {
      setSelectedPromptTitle("Some Prompt");
      setDisableBuiltinSystemPrompt(true);

      resetSessionSystemPromptSettings();

      expect(getSelectedPromptTitle()).toBe("");
      expect(getDisableBuiltinSystemPrompt()).toBe(false);
    });

    it("works correctly when called multiple times", () => {
      setSelectedPromptTitle("Prompt 1");
      setDisableBuiltinSystemPrompt(true);
      resetSessionSystemPromptSettings();

      setSelectedPromptTitle("Prompt 2");
      setDisableBuiltinSystemPrompt(true);
      resetSessionSystemPromptSettings();

      expect(getSelectedPromptTitle()).toBe("");
      expect(getDisableBuiltinSystemPrompt()).toBe(false);
    });
  });

  describe("getDisableBuiltinSystemPrompt", () => {
    it("returns false by default", () => {
      expect(getDisableBuiltinSystemPrompt()).toBe(false);
    });

    it("returns true after being set to true", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(getDisableBuiltinSystemPrompt()).toBe(true);
    });

    it("returns false after being set to false", () => {
      setDisableBuiltinSystemPrompt(true);
      setDisableBuiltinSystemPrompt(false);
      expect(getDisableBuiltinSystemPrompt()).toBe(false);
    });

    it("maintains state across multiple reads", () => {
      setDisableBuiltinSystemPrompt(true);
      expect(getDisableBuiltinSystemPrompt()).toBe(true);
      expect(getDisableBuiltinSystemPrompt()).toBe(true);
      expect(getDisableBuiltinSystemPrompt()).toBe(true);
    });
  });

  describe("getDefaultSystemPromptTitle", () => {
    it("returns default prompt title from settings", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "My Default Prompt",
      } as any);

      expect(getDefaultSystemPromptTitle()).toBe("My Default Prompt");
    });

    it("returns empty string when no default is set", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "",
      } as any);

      expect(getDefaultSystemPromptTitle()).toBe("");
    });
  });

  describe("setDefaultSystemPromptTitle", () => {
    it("calls updateSetting with correct parameters", () => {
      setDefaultSystemPromptTitle("New Default Prompt");

      expect(settingsModel.updateSetting).toHaveBeenCalledWith(
        "defaultSystemPromptTitle",
        "New Default Prompt"
      );
    });

    it("can set empty string as default", () => {
      setDefaultSystemPromptTitle("");

      expect(settingsModel.updateSetting).toHaveBeenCalledWith("defaultSystemPromptTitle", "");
    });
  });

  describe("initializeSessionPromptFromDefault", () => {
    it("sets session prompt to global default", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Global Default",
      } as any);

      initializeSessionPromptFromDefault();

      expect(getSelectedPromptTitle()).toBe("Global Default");
    });

    it("sets session prompt to empty string when no global default", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "",
      } as any);

      initializeSessionPromptFromDefault();

      expect(getSelectedPromptTitle()).toBe("");
    });
  });

  describe("Integration: Migration and Effective Content", () => {
    it("returns migrated prompt content after migration sets default", () => {
      const migratedPrompt: UserSystemPrompt = {
        title: "Migrated Custom System Prompt",
        content: "This is my migrated legacy prompt",
        createdMs: Date.now(),
        modifiedMs: Date.now(),
        lastUsedMs: 0,
      };

      // Simulate migration: add prompt to cache and set as default
      updateCachedSystemPrompts([migratedPrompt]);
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Migrated Custom System Prompt",
      } as any);

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("This is my migrated legacy prompt");
    });

    it("session prompt overrides migrated default prompt", () => {
      const migratedPrompt: UserSystemPrompt = {
        title: "Migrated Custom System Prompt",
        content: "Migrated content",
        createdMs: Date.now(),
        modifiedMs: Date.now(),
        lastUsedMs: 0,
      };

      const sessionPrompt: UserSystemPrompt = {
        title: "Session Override",
        content: "Session content",
        createdMs: Date.now(),
        modifiedMs: Date.now(),
        lastUsedMs: 0,
      };

      updateCachedSystemPrompts([migratedPrompt, sessionPrompt]);
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Migrated Custom System Prompt",
      } as any);

      setSelectedPromptTitle("Session Override");

      const result = getEffectiveSystemPromptContent();

      expect(result).toBe("Session content");
    });

    it("reset clears session override and falls back to migrated default", () => {
      const migratedPrompt: UserSystemPrompt = {
        title: "Migrated Custom System Prompt",
        content: "Migrated content",
        createdMs: Date.now(),
        modifiedMs: Date.now(),
        lastUsedMs: 0,
      };

      const sessionPrompt: UserSystemPrompt = {
        title: "Session Override",
        content: "Session content",
        createdMs: Date.now(),
        modifiedMs: Date.now(),
        lastUsedMs: 0,
      };

      updateCachedSystemPrompts([migratedPrompt, sessionPrompt]);
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Migrated Custom System Prompt",
      } as any);

      // Set session override
      setSelectedPromptTitle("Session Override");
      expect(getEffectiveSystemPromptContent()).toBe("Session content");

      // Reset session
      resetSessionSystemPromptSettings();
      expect(getEffectiveSystemPromptContent()).toBe("Migrated content");
    });
  });

  describe("Session vs Persistent State", () => {
    it("session state is independent from persistent state", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Persistent Default",
      } as any);

      setSelectedPromptTitle("Session Selection");

      expect(getSelectedPromptTitle()).toBe("Session Selection");
      expect(getDefaultSystemPromptTitle()).toBe("Persistent Default");
    });

    it("changing session state does not affect persistent state", () => {
      jest.spyOn(settingsModel, "getSettings").mockReturnValue({
        defaultSystemPromptTitle: "Persistent Default",
      } as any);

      setSelectedPromptTitle("Session Selection");
      setSelectedPromptTitle("Another Session Selection");

      expect(getDefaultSystemPromptTitle()).toBe("Persistent Default");
      expect(settingsModel.updateSetting).not.toHaveBeenCalled();
    });

    it("changing persistent state does not affect session state", () => {
      setSelectedPromptTitle("Session Selection");

      setDefaultSystemPromptTitle("New Persistent Default");

      expect(getSelectedPromptTitle()).toBe("Session Selection");
    });
  });
});
