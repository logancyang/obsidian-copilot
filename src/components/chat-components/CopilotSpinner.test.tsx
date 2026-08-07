import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import { render } from "@testing-library/react";
import React from "react";

describe("CopilotSpinner", () => {
  describe("CopilotSpinner()", () => {
    it("animates by default", () => {
      const { container } = render(<CopilotSpinner />);

      expect(container.querySelectorAll('[class*="copilot-spinner-dot-"]')).toHaveLength(7);
    });

    it("renders the same icon without animation classes when animation is disabled", () => {
      const { container } = render(<CopilotSpinner animated={false} />);

      expect(container.querySelectorAll(".copilot-spinner-dot")).toHaveLength(7);
      expect(container.querySelectorAll('[class*="copilot-spinner-dot-"]')).toHaveLength(0);
    });
  });
});
