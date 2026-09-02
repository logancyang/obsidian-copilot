import { EVENT_NAMES } from "@/constants";
import { ChatViewEventTarget } from "@/context";

describe("context", () => {
  describe("ChatViewEventTarget", () => {
    describe("queueSubmitPrompt()", () => {
      it("notifies a mounted Agent Chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        const eventTarget = new ChatViewEventTarget();
        const listener = jest.fn();
        eventTarget.addEventListener(EVENT_NAMES.SUBMIT_AGENT_PROMPT, listener);

        eventTarget.queueSubmitPrompt("Publish Notes/Active.md");

        expect(listener).toHaveBeenCalledTimes(1);
      });
    });

    describe("consumePendingSubmitPrompt()", () => {
      it("delivers two pre-mount prompts once in FIFO order for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", () => {
        const eventTarget = new ChatViewEventTarget();
        eventTarget.queueSubmitPrompt("Publish Notes/First.md");
        eventTarget.queueSubmitPrompt("Publish Notes/Second.md");

        expect(eventTarget.consumePendingSubmitPrompt()).toBe("Publish Notes/First.md");
        expect(eventTarget.consumePendingSubmitPrompt()).toBe("Publish Notes/Second.md");
        expect(eventTarget.consumePendingSubmitPrompt()).toBeNull();
      });
    });
  });
});
