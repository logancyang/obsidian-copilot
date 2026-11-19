import type { CustomAgent } from "@/agents/CustomAgentStore";
import {
  AgentProfileView,
  type AgentProfileFacts,
  type AgentProfileViewProps,
} from "@/agents/ui/AgentProfileView";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";

const NOW = new Date(2026, 10, 16, 15, 20).getTime();

function agent(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "coco",
    name: "Coco",
    title: "Keeps the whole vault in view",
    instruction: "You keep the whole vault in view. Answer briefly.",
    faceSrc: "face:coco",
    instructionsPath: "copilot/agents/coco/instructions.md",
    memoryPath: "copilot/agents/coco/MEMORY.md",
    ...overrides,
  } as CustomAgent;
}

const FACTS: AgentProfileFacts = {
  chatCount: 23,
  createdAt: new Date(2026, 9, 3, 9, 0).getTime(),
  editedAt: new Date(2026, 10, 2, 17, 45).getTime(),
  memory: { rules: 9, changedAt: new Date(2026, 10, 16, 14, 31).getTime() },
};

function renderProfile(props: Partial<AgentProfileViewProps> = {}) {
  const handlers = { onBack: jest.fn(), onNewChat: jest.fn(), onOpenFile: jest.fn() };
  render(<AgentProfileView agent={agent()} facts={FACTS} now={NOW} {...handlers} {...props} />);
  return handlers;
}

describe("AgentProfileView", () => {
  describe("AgentProfileView()", () => {
    it("shows the agent's face, name, title, how many chats it has had and since when", () => {
      renderProfile();

      expect(screen.getByRole("img", { hidden: true }).getAttribute("src")).toBe("face:coco");
      expect(screen.getByText("Coco")).not.toBeNull();
      expect(screen.getByText("Keeps the whole vault in view")).not.toBeNull();
      expect(screen.getByText("23 chats · since Oct 3")).not.toBeNull();
    });

    it("names the page by the agent and its section by what the agent knows, as headings", () => {
      renderProfile();

      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Coco");
      expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("What Coco knows");
    });

    it("counts one chat in the singular and a first day as today", () => {
      renderProfile({ facts: { ...FACTS, chatCount: 1, createdAt: NOW - 60_000 } });

      expect(screen.getByText("1 chat · since today")).not.toBeNull();
    });

    it("names the year of a start date from another year and leaves the count out until it loads", () => {
      renderProfile({
        facts: { ...FACTS, chatCount: null, createdAt: new Date(2025, 0, 9).getTime() },
      });

      expect(screen.getByText("since Jan 9, 2025")).not.toBeNull();
    });

    it(`shows the instruction's first sentence when the agent has no title (${ISSUE})`, () => {
      renderProfile({ agent: agent({ title: "" }) });

      expect(screen.getByText("You keep the whole vault in view.")).not.toBeNull();
    });

    it("shows what the agent handles, who writes it and when it was last edited, and opens instructions.md", () => {
      const { onOpenFile } = renderProfile();

      const row = screen.getByRole("button", { name: /What Coco handles/ });
      expect(row.textContent).toContain("Instruction · you write this · edited Nov 2");
      fireEvent.click(row);

      expect(onOpenFile).toHaveBeenCalledWith("copilot/agents/coco/instructions.md");
    });

    it("says an instruction not edited since the day it was made was written then", () => {
      renderProfile({ facts: { ...FACTS, createdAt: NOW - 3_600_000, editedAt: NOW - 60_000 } });

      expect(screen.getByText("Instruction · you write this · written today")).not.toBeNull();
    });

    it(`notes in orange that an instruction past 4,000 characters is longer than the agent follows well (${ISSUE})`, () => {
      renderProfile({ agent: agent({ instruction: "x".repeat(4620) }) });

      const note = screen.getByText(
        "Instruction · 4,620 characters · longer than Coco follows well"
      );
      expect(note.className).toContain("tw-text-warning");
    });

    it("counts only the instruction's text, without the whitespace around it", () => {
      renderProfile({ agent: agent({ instruction: `\n${"x".repeat(4001)}\n\n` }) });

      expect(
        screen.getByText("Instruction · 4,001 characters · longer than Coco follows well")
      ).not.toBeNull();
    });

    it("keeps an instruction of exactly 4,000 characters in the normal note", () => {
      renderProfile({ agent: agent({ instruction: "x".repeat(4000) }) });

      expect(
        screen.getByText("Instruction · you write this · edited Nov 2").className
      ).not.toContain("tw-text-warning");
    });

    it("shows the rules the agent remembers with their count and today's last change, and opens MEMORY.md", () => {
      const { onOpenFile } = renderProfile();

      const row = screen.getByRole("button", { name: /Rules Coco remembers/ });
      expect(row.textContent).toContain("Memory · Coco adds to this · 9 rules · today 14:31");
      fireEvent.click(row);

      expect(onOpenFile).toHaveBeenCalledWith("copilot/agents/coco/MEMORY.md");
    });

    it("dates a memory change from an earlier day by its day and counts one rule in the singular", () => {
      renderProfile({
        facts: {
          ...FACTS,
          memory: { rules: 1, changedAt: new Date(2026, 10, 12, 8, 5).getTime() },
        },
      });

      expect(screen.getByText("Memory · Coco adds to this · 1 rule · Nov 12")).not.toBeNull();
    });

    it(`says a new agent has saved nothing yet, with no Open, while MEMORY.md does not exist (${ISSUE})`, () => {
      renderProfile({ agent: agent({ name: "Kai" }), facts: { ...FACTS, memory: null } });

      expect(screen.queryByRole("button", { name: /Rules Kai remembers/ })).toBeNull();
      expect(
        screen.getByText(
          "Nothing yet. Kai adds a rule when you correct it or ask it to remember something."
        )
      ).not.toBeNull();
      expect(screen.getAllByText("Open")).toHaveLength(1);
    });

    it("starts a new chat with the agent", () => {
      const { onNewChat } = renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "New chat with Coco" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
    });

    it(`goes back to the chat from Back or Esc (${ISSUE})`, () => {
      const { onBack } = renderProfile();

      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      fireEvent.keyDown(screen.getByRole("button", { name: "New chat with Coco" }), {
        key: "Escape",
      });

      expect(onBack).toHaveBeenCalledTimes(2);
    });

    it("puts the keyboard on Back when the profile opens", () => {
      renderProfile();

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to chat" }));
    });
  });
});
