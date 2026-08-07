import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { render } from "@testing-library/react";
import React from "react";

describe("AgentReasoningBlock", () => {
  describe("AgentReasoningBlock()", () => {
    it("keeps the brain icon when reasoning changes from active to complete", () => {
      const { container, rerender } = render(
        <AgentReasoningBlock
          status="reasoning"
          elapsedSeconds={3}
          steps={["Inspecting the current interface"]}
          isStreaming
        />
      );

      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner")).toBeNull();
      expect(
        container
          .querySelector(".lucide-brain")
          ?.parentElement?.parentElement?.classList.contains("tw-pl-1")
      ).toBe(true);

      rerender(
        <AgentReasoningBlock
          status="complete"
          elapsedSeconds={4}
          steps={["Inspecting the current interface"]}
          isStreaming={false}
        />
      );

      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner")).toBeNull();
    });
  });
});
