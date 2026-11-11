import { makeReadOnlySkill } from "@/agentMode/skills/testing/readOnlySkillFixtures";
import type { AgentBrand } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import React from "react";
import { ReadOnlySkillRow } from "./ReadOnlySkillRow";

const AGENTS: AgentBrand[] = [
  { id: "claude", displayName: "Claude", Icon: Bot },
  { id: "codex", displayName: "Codex", Icon: Bot },
  { id: "opencode", displayName: "OpenCode", Icon: Bot },
];

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  if (!("PointerEvent" in window)) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

function renderRow(overrides: Partial<React.ComponentProps<typeof ReadOnlySkillRow>> = {}) {
  const props = {
    skill: makeReadOnlySkill({
      name: "release-notes",
      description: "Write release notes",
      agents: ["claude", "opencode"],
    }),
    agents: AGENTS,
    locationLabel: "~/.claude/skills",
    revealLabel: "Show in folder",
    onOpenSkillMd: jest.fn(),
    onReveal: jest.fn(),
    containerRef: { current: null },
    ...overrides,
  };
  render(<ReadOnlySkillRow {...props} />);
  return props;
}

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText(/More actions/i), { button: 0, ctrlKey: false });
}

describe("ReadOnlySkillRow", () => {
  describe("ReadOnlySkillRow()", () => {
    it("https://github.com/logancyang/obsidian-copilot/issues/3659 shows the skill's name, description, folder, and the agents that use it, with no agent switches", () => {
      renderRow();
      expect(screen.getByText("release-notes")).not.toBeNull();
      expect(screen.getByText("Write release notes")).not.toBeNull();
      expect(screen.getByText("in ~/.claude/skills")).not.toBeNull();
      expect(screen.getByRole("img", { name: "Used by Claude, OpenCode" })).not.toBeNull();
      expect(screen.queryByRole("button", { pressed: true })).toBeNull();
      expect(screen.queryByRole("button", { pressed: false })).toBeNull();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 offers only opening SKILL.md and locating its folder, with no edit, rename, or delete", () => {
      const props = renderRow({ revealLabel: "Reveal in vault" });
      openMenu();
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "Open SKILL.md",
        "Reveal in vault",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Open SKILL.md" }));
      expect(props.onOpenSkillMd).toHaveBeenCalledTimes(1);
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in vault" }));
      expect(props.onReveal).toHaveBeenCalledTimes(1);
    });
  });
});
