import { CopilotPlusWelcomeModalContent } from "./CopilotPlusWelcomeModal";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("CopilotPlusWelcomeModal", () => {
  describe("CopilotPlusWelcomeModalContent()", () => {
    it("names the model it is offering to make the default", () => {
      render(<CopilotPlusWelcomeModalContent onConfirm={jest.fn()} onCancel={jest.fn()} />);

      expect(screen.getByText("copilot-plus-flash")).toBeTruthy();
      expect(screen.getByText(/default model for chat and your agents/)).toBeTruthy();
    });

    it("names what the license includes, including the symposium link", () => {
      render(<CopilotPlusWelcomeModalContent onConfirm={jest.fn()} onCancel={jest.fn()} />);

      const link = screen.getByRole("link", { name: "symposium.md" });
      expect(link.getAttribute("href")).toBe("https://symposium.md");
      expect(screen.getByText(/Copilot exclusive/)).toBeTruthy();
      expect(screen.getByText(/cross-agent skills/)).toBeTruthy();
    });

    it("promises no capability a lower paid tier may not have", () => {
      const { container } = render(
        <CopilotPlusWelcomeModalContent onConfirm={jest.fn()} onCancel={jest.fn()} />
      );

      // Multi-agent is tier >= Plus (see `canUseMultiAgent`), so a Lite user
      // opening this modal must not be told they have it. Same for a blanket
      // "full power" claim, which is true of no single tier.
      expect(container.textContent).not.toMatch(/multi-agent|full power|full potential/i);
    });

    it("offers to apply no mode, no embedding model, and no vault rebuild", () => {
      const { container } = render(
        <CopilotPlusWelcomeModalContent onConfirm={jest.fn()} onCancel={jest.fn()} />
      );

      // The settings this used to apply, by the labels it applied them under —
      // "embedding models" still appears in the feature list, which is true and
      // not a promise to change one. `\b` keeps "default mode" from matching
      // inside the offer's own "default model".
      expect(container.textContent).not.toMatch(/default mode\b|embedding model:|rebuild/i);
    });

    it("confirms on Apply Now and declines on Apply Later, never both", () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      render(<CopilotPlusWelcomeModalContent onConfirm={onConfirm} onCancel={onCancel} />);

      fireEvent.click(screen.getByRole("button", { name: "Apply Now" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Apply Later" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
