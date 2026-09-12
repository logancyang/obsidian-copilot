import {
  updateCachedSystemPrompts,
  getSelectedPromptTitle,
  setSelectedPromptTitle,
  getDisableBuiltinSystemPrompt,
  setDisableBuiltinSystemPrompt,
  resetSessionSystemPromptSettings,
} from "@/system-prompts/state";
describe("System Prompts State Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset state by clearing prompts
    updateCachedSystemPrompts([]);
    setSelectedPromptTitle("");
    setDisableBuiltinSystemPrompt(false);
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
});
