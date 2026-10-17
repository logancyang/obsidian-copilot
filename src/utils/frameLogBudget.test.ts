import { fitConversationFrames } from "@/utils/frameLogBudget";
import { byteLength } from "@/utils/logTail";

describe("frameLogBudget", () => {
  describe("fitConversationFrames()", () => {
    it("returns a conversation unchanged when it fits", () => {
      const text = '{"id":"first"}\n{"id":"last"}\n';
      expect(fitConversationFrames(text, byteLength(text))).toBe(text);
    });

    it("refuses a budget smaller than the state rather than silently dropping a conversation (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", () => {
      expect(() =>
        fitConversationFrames('{"method":"frameSink.state","payload":{"model":"model-a"}}\n', 1)
      ).toThrow("Conversation state exceeds the frame-log budget");
    });

    it("keeps state plus complete UTF-8 head/tail frames within a reduced budget (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", () => {
      const state = '{"method":"frameSink.state","payload":{"model":"model-a"}}\n';
      const text = state + '{"id":"first"}\n' + '{"text":"漢字"}\n'.repeat(100) + '{"id":"last"}\n';
      const kept = fitConversationFrames(text, 300);
      expect(kept).toContain(state);
      expect(kept).toContain('"id":"first"');
      expect(kept).toContain('"id":"last"');
      expect(kept).toContain('"frameSink":"elided"');
      expect(byteLength(kept)).toBeLessThanOrEqual(300);
      for (const line of kept.trim().split("\n")) {
        expect(() => {
          JSON.parse(line);
        }).not.toThrow();
      }
    });
  });
});
