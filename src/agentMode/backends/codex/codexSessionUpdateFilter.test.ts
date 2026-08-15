import type { AcpSessionUpdate } from "@/agentMode/acp/types";
import { shouldRouteCodexSessionUpdate } from "./codexSessionUpdateFilter";

function textUpdate(text: string): AcpSessionUpdate {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  };
}

describe("codexSessionUpdateFilter", () => {
  describe("shouldRouteCodexSessionUpdate()", () => {
    it("drops the percentage and percentage-free skills-budget warnings", () => {
      expect(
        shouldRouteCodexSessionUpdate(
          textUpdate(
            "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
              "Codex can still see every skill, but some descriptions are shorter. " +
              "Disable unused skills or plugins to leave more room for the rest.\n\n"
          )
        )
      ).toBe(false);
      expect(
        shouldRouteCodexSessionUpdate(
          textUpdate(
            "Warning: Skill descriptions were shortened to fit the skills context budget. " +
              "Codex can still see every skill, but some descriptions are shorter."
          )
        )
      ).toBe(false);
    });

    it("keeps unrelated warnings and ordinary answers that mention the budget", () => {
      expect(shouldRouteCodexSessionUpdate(textUpdate("Warning: Codex login expired.\n\n"))).toBe(
        true
      );
      expect(
        shouldRouteCodexSessionUpdate(
          textUpdate("I investigated the skills context budget and found the cause.")
        )
      ).toBe(true);
    });

    it("keeps non-message and non-text updates", () => {
      expect(
        shouldRouteCodexSessionUpdate({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Warning: Skill descriptions were shortened to fit " },
        })
      ).toBe(true);
      expect(
        shouldRouteCodexSessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "image", mimeType: "image/png", data: "aGk=" },
        })
      ).toBe(true);
    });
  });
});
