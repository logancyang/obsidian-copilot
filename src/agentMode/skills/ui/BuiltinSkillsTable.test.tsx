import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Bot } from "lucide-react";
import { BuiltinSkillsTable, type BuiltinSkillsTableProps } from "./BuiltinSkillsTable";

const issue = "https://github.com/logancyang/obsidian-copilot/issues/3022";
function props(): BuiltinSkillsTableProps {
  return {
    skills: [
      {
        name: "transcript",
        description: "Read video transcripts",
        content: "# Read a transcript",
        enabledAgents: ["claude", "opencode"],
      },
    ],
    agents: [
      { id: "claude", displayName: "Claude", Icon: Bot },
      { id: "opencode", displayName: "OpenCode", Icon: Bot },
    ],
    availableAgents: ["claude"],
    pendingSkills: [],
    onToggleSkill: jest.fn(),
    onToggleAgent: jest.fn(),
  };
}
describe("BuiltinSkillsTable", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("BuiltinSkillsTable()", () => {
    it(`does not render unrelated rows when a skill menu opens or its preference changes for ${issue}`, () => {
      const p = props();
      const Icon = jest.fn(() => <span />);
      p.agents = [{ id: "claude", displayName: "Claude", Icon }];
      p.skills = [p.skills[0], { ...p.skills[0], name: "other" }];
      const { rerender } = render(<BuiltinSkillsTable {...p} />);
      expect(Icon).toHaveBeenCalledTimes(2);
      fireEvent.pointerDown(screen.getByLabelText("More actions for transcript"), {
        button: 0,
        ctrlKey: false,
      });
      expect(Icon).toHaveBeenCalledTimes(3);
      Icon.mockClear();
      rerender(
        <BuiltinSkillsTable
          {...p}
          skills={[...p.skills]}
          preferences={{ transcript: { disabled: true } }}
        />
      );
      expect(Icon).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "other for Claude" }).getAttribute("aria-disabled")
      ).toBe("false");
    });
    it(`updates agent opt-outs without rendering another skill with saved preferences for ${issue}`, () => {
      const p = props();
      const Icon = jest.fn(() => <span />);
      p.agents = [{ id: "claude", displayName: "Claude", Icon }];
      p.skills = [p.skills[0], { ...p.skills[0], name: "other" }];
      const otherPreference = { disabledAgents: ["opencode"] };
      p.preferences = { other: otherPreference };
      const { rerender } = render(<BuiltinSkillsTable {...p} />);
      Icon.mockClear();
      rerender(
        <BuiltinSkillsTable
          {...p}
          preferences={{ other: otherPreference, transcript: { disabledAgents: ["claude"] } }}
        />
      );
      expect(Icon).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "transcript for Claude" }).getAttribute("aria-pressed")
      ).toBe("false");
      expect(
        screen.getByRole("button", { name: "other for Claude" }).getAttribute("aria-pressed")
      ).toBe("true");
    });
    it(`labels a disabled skill and removes the label when re-enabled for ${issue}`, () => {
      const p = props();
      const { rerender } = render(
        <BuiltinSkillsTable {...p} preferences={{ transcript: { disabled: true } }} />
      );
      expect(screen.getByText("Disabled")).toBeTruthy();
      rerender(<BuiltinSkillsTable {...p} />);
      expect(screen.queryByText("Disabled")).toBeNull();
    });
    it(`reports whole-skill and agent choices independently for ${issue}`, () => {
      const p = props();
      render(<BuiltinSkillsTable {...p} />);
      fireEvent.pointerDown(screen.getByLabelText("More actions for transcript"), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Disable skill" }));
      expect(p.onToggleSkill).toHaveBeenCalledWith("transcript", false);
      fireEvent.click(screen.getByRole("button", { name: "transcript for Claude" }));
      expect(p.onToggleAgent).toHaveBeenCalledWith("transcript", "claude", false);
    });
    it(`keeps unavailable agents unchecked and inert for ${issue}`, () => {
      const p = props();
      render(<BuiltinSkillsTable {...p} />);
      const agent = screen.getByRole("button", { name: "Set up OpenCode to enable" });
      expect(agent.getAttribute("aria-pressed")).toBe("false");
      expect(agent.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(agent);
      expect(p.onToggleAgent).not.toHaveBeenCalled();
    });
    it.each(["disabled", "unavailable", "pending"])(
      `prevents agent changes when %s for ${issue}`,
      (state) => {
        const p = props();
        p.preferences = { transcript: { disabled: state === "disabled" } };
        p.unavailableReasons =
          state === "unavailable" ? { transcript: "Requires Miyo" } : undefined;
        p.pendingSkills = state === "pending" ? ["transcript"] : [];
        render(<BuiltinSkillsTable {...p} />);
        const agent = screen.getByRole("button", { name: "transcript for Claude" });
        expect(agent.getAttribute("aria-disabled")).toBe("true");
        fireEvent.click(agent);
        expect(p.onToggleAgent).not.toHaveBeenCalled();
      }
    );
    it(`offers read-only content without edit or delete actions for ${issue}`, () => {
      render(<BuiltinSkillsTable {...props()} />);
      expect(screen.queryByText("# Read a transcript")).toBeNull();
      fireEvent.pointerDown(screen.getByLabelText("More actions for transcript"), {
        button: 0,
        ctrlKey: false,
      });
      expect(screen.getAllByRole("menuitem")).toHaveLength(2);
      expect(screen.queryByText(/Delete|Properties|Edit SKILL/)).toBeNull();
      fireEvent.click(screen.getByRole("menuitem", { name: "View SKILL.md (read-only)" }));
      expect(screen.getByText("# Read a transcript")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByText(/Delete|Properties|Edit SKILL/)).toBeNull();
    });
    it(`shows errors and an empty search result for ${issue}`, () => {
      render(<BuiltinSkillsTable {...props()} skills={[]} error="Cleanup failed" />);
      expect(screen.getByRole("alert").textContent).toBe("Cleanup failed");
      expect(screen.getByText("No built-in skills match your search.")).toBeTruthy();
    });
  });
});
