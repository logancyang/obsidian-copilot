import {
  AgentModePromoRow,
  type AgentModePromoRowProps,
} from "@/components/chat-components/ui/AgentModePromoRow";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let mockDesktopRuntime = true;

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: () => mockDesktopRuntime,
}));

const COPY = "Agent mode is here: more capable models, tools, and skills.";

function renderRow(overrides: Partial<AgentModePromoRowProps> = {}) {
  const props: AgentModePromoRowProps = {
    dismissed: false,
    onOpenAgent: jest.fn(),
    onDismiss: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<AgentModePromoRow {...props} />) };
}

describe("AgentModePromoRow", () => {
  describe("AgentModePromoRow()", () => {
    beforeEach(() => {
      mockDesktopRuntime = true;
    });

    it("announces Agent mode with the brand mark and no retirement wording", () => {
      const { container } = renderRow();

      expect(screen.getByRole("button", { name: COPY })).toBeTruthy();
      expect(container.querySelector('svg[viewBox="0 0 100 100"]')).not.toBeNull();
      expect(container.textContent).not.toMatch(/retiring|deprecated|legacy|V3/i);
    });

    it("opens Agent when the row is selected", () => {
      const { props } = renderRow();

      fireEvent.click(screen.getByRole("button", { name: COPY }));

      expect(props.onOpenAgent).toHaveBeenCalledTimes(1);
    });

    it("reports the user's dismissal without opening Agent", () => {
      const { props } = renderRow();

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(props.onDismiss).toHaveBeenCalledTimes(1);
      expect(props.onOpenAgent).not.toHaveBeenCalled();
    });

    it("renders nothing once the persisted dismissal is set", () => {
      const { container } = renderRow({ dismissed: true });

      expect(container.firstChild).toBeNull();
    });

    it("hides the Agent promotion on mobile because Agent is unavailable (https://github.com/logancyang/obsidian-copilot-preview/issues/323)", () => {
      mockDesktopRuntime = false;

      const { container } = renderRow();

      expect(container.firstChild).toBeNull();
    });
  });
});
