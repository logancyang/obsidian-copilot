import { AgentMemoryNoticeLine } from "@/agentMode/ui/AgentMemoryNoticeLine";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentMemoryNoticeLine", () => {
  describe("AgentMemoryNoticeLine()", () => {
    it("names the agent rather than guessing a pronoun (CUSTOM_AGENTS.md §5)", () => {
      render(<AgentMemoryNoticeLine kind="flush" agentName="Jennifer" onOpen={jest.fn()} />);

      expect(screen.getByText("Jennifer added to today's notes")).toBeTruthy();
    });

    it("says the memory was consolidated when the pass rebuilt the curated file", () => {
      render(
        <AgentMemoryNoticeLine kind="consolidation" agentName="Jennifer" onOpen={jest.fn()} />
      );

      expect(screen.getByText("Jennifer consolidated their memory")).toBeTruthy();
    });

    it("offers the file so the user can read what was written about them", () => {
      const onOpen = jest.fn();
      render(<AgentMemoryNoticeLine kind="flush" agentName="Jennifer" onOpen={onOpen} />);

      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
