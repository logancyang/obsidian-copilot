import {
  updateCachedSystemPrompts,
  getSelectedPromptTitle,
  setSelectedPromptTitle,
  getDisableBuiltinSystemPrompt,
  setDisableBuiltinSystemPrompt,
  resetSessionSystemPromptSettings,
} from "@/system-prompts/state";

describe("state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateCachedSystemPrompts([]);
    setSelectedPromptTitle("");
    setDisableBuiltinSystemPrompt(false);
  });

  describe("resetSessionSystemPromptSettings()", () => {
    it("clears the selected prompt title and re-enables the built-in system prompt", () => {
      setSelectedPromptTitle("Some Prompt");
      setDisableBuiltinSystemPrompt(true);

      resetSessionSystemPromptSettings();

      expect(getSelectedPromptTitle()).toBe("");
      expect(getDisableBuiltinSystemPrompt()).toBe(false);
    });
  });

  describe("getDisableBuiltinSystemPrompt()", () => {
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
  });
});
