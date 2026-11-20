import { buildCopilotChatPrompt } from "@/agentMode/session/copilotChatPrompt";
import { setDisableBuiltinSystemPrompt } from "@/system-prompts/state";

describe("copilotChatPrompt", () => {
  describe("buildCopilotChatPrompt()", () => {
    afterEach(() => setDisableBuiltinSystemPrompt(false));

    it("tells a chat that runs as no agent that it is Obsidian Copilot", () => {
      expect(buildCopilotChatPrompt()).toBe("You are Obsidian Copilot.");
    });

    it("gives no text while the user turns the built-in prompt off, as the prompt every chat shares does (https://github.com/Brevilabs/obsidian-copilot-private/issues/986)", () => {
      setDisableBuiltinSystemPrompt(true);

      expect(buildCopilotChatPrompt()).toBeNull();
    });
  });
});
