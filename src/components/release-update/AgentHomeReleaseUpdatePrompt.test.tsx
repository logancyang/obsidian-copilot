import { AgentHomeReleaseUpdatePrompt } from "@/components/release-update/AgentHomeReleaseUpdatePrompt";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/317";

describe("AgentHomeReleaseUpdatePrompt", () => {
  describe("AgentHomeReleaseUpdatePrompt()", () => {
    it(`renders the large bottom banner requested in ${ISSUE_URL}`, () => {
      const onDismiss = jest.fn();
      const onOpen = jest.fn();

      render(
        <AgentHomeReleaseUpdatePrompt onDismiss={onDismiss} onOpen={onOpen} version="4.0.4" />
      );

      const prompt = screen.getByRole("status");
      expect(prompt.getAttribute("data-agent-home-release-update")).toBe("bottom-banner");
      expect(prompt.classList.contains("tw-inset-x-0")).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "See what’s new" }));
      fireEvent.click(screen.getByRole("button", { name: "Dismiss release update" }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});
