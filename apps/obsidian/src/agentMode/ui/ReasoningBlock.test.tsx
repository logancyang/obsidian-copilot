import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("ReasoningBlock", () => {
  describe("ReasoningBlock()", () => {
    it("renders the event-backed duration after remount (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      render(
        <ReasoningBlock
          part={{
            kind: "thought",
            text: "Compare the grouped steps.",
            startedAtMs: 1_000,
            durationMs: 18_426,
          }}
          isStreaming={false}
        />
      );

      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("18s")).toBeTruthy();
    });

    it("keeps legacy completed thoughts at less than one second when timing is unavailable (https://github.com/Brevilabs/obsidian-copilot-private/issues/336)", () => {
      render(
        <ReasoningBlock
          part={{ kind: "thought", text: "A restored thought without timing." }}
          isStreaming={false}
        />
      );

      expect(screen.getByText("< 1s")).toBeTruthy();
    });
  });
});
