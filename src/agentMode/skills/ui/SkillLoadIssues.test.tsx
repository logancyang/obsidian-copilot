import { ReactModal } from "@/components/modals/ReactModal";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";
import {
  SkillLoadIssues,
  SkillLoadIssuesModal,
  SkillLoadIssuesModalContent,
  type SkillLoadIssue,
} from "./SkillLoadIssues";

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/166";

describe("SkillLoadIssues", () => {
  describe("SkillLoadIssues()", () => {
    it(`keeps one rejected skill compact while surfacing its high-level cause for ${ISSUE_URL}`, () => {
      const onViewDetails = jest.fn();
      render(<SkillLoadIssues issues={[makeIssue()]} onViewDetails={onViewDetails} />);

      expect(screen.getByRole("alert", { name: "1 skill could not be loaded" })).not.toBeNull();
      expect(
        screen.getByText("Not available to agents. The description is not quoted.")
      ).not.toBeNull();
      expect(screen.queryByText(makeIssue().name)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      expect(onViewDetails).toHaveBeenCalledTimes(1);
    });

    it(`collapses a shared cause into one explanation for ${ISSUE_URL}`, () => {
      render(
        <SkillLoadIssues
          issues={[makeIssue(), makeIssue({ name: "second", location: ".claude/skills/second/" })]}
          onViewDetails={jest.fn()}
        />
      );

      expect(
        screen.getByText("Not available to agents. All have an unquoted description.")
      ).not.toBeNull();
    });

    it(`summarizes mixed causes without expanding their repair rows for ${ISSUE_URL}`, () => {
      render(
        <SkillLoadIssues
          issues={[
            makeIssue(),
            makeIssue({
              name: "second",
              location: ".claude/skills/second/",
              reason: "Missing name.",
            }),
          ]}
          onViewDetails={jest.fn()}
        />
      );

      expect(screen.getByText(/Not available to agents.*different format errors/)).not.toBeNull();
      expect(screen.queryByText("Missing name.")).toBeNull();
    });
  });

  describe("SkillLoadIssuesModalContent()", () => {
    it(`states a shared cause once and closes before either file action for ${ISSUE_URL}`, () => {
      const order: string[] = [];
      render(
        <SkillLoadIssuesModalContent
          issues={[
            makeIssue({
              onOpen: () => order.push("open"),
              onReveal: () => order.push("reveal"),
            }),
            makeIssue({
              name: "without-fix",
              location: ".claude/skills/without-fix/",
              suggestion: undefined,
            }),
          ]}
          onClose={() => order.push("close")}
        />
      );

      expect(screen.getByText(makeIssue().location)).not.toBeNull();
      expect(screen.getByText(makeIssue().suggestion as string)).not.toBeNull();
      expect(screen.getByText("without-fix")).not.toBeNull();
      expect(screen.getAllByText(makeIssue().suggestion as string)).toHaveLength(1);
      expect(screen.getByText("The description is not quoted.")).not.toBeNull();
      expect(screen.queryByText(makeIssue().reason)).toBeNull();

      fireEvent.click(screen.getAllByRole("button", { name: "Open SKILL.md" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "Show in folder" })[0]);
      expect(order).toEqual(["close", "open", "close", "reveal"]);
    });

    it(`groups mixed causes so each explanation renders once for ${ISSUE_URL}`, () => {
      render(
        <SkillLoadIssuesModalContent
          issues={[
            makeIssue(),
            makeIssue({ name: "second", location: ".claude/skills/second/" }),
            makeIssue({
              name: "third",
              location: ".claude/skills/third/",
              reason: "Missing name.",
            }),
          ]}
          onClose={jest.fn()}
        />
      );

      expect(screen.getByText("The description is not quoted.")).not.toBeNull();
      expect(screen.getByText("Missing name.")).not.toBeNull();
      expect(screen.queryByText(makeIssue().reason)).toBeNull();
      expect(screen.getAllByRole("article")).toHaveLength(3);
    });
  });

  describe("SkillLoadIssuesModal", () => {
    describe("constructor()", () => {
      it(`uses truthful singular native title copy for ${ISSUE_URL}`, () => {
        const modal = new SkillLoadIssuesModal(new App(), [makeIssue()]);

        expect(modal.titleEl.textContent).toBe("1 skill could not be loaded");
      });
    });

    describe("onOpen()", () => {
      it(`renders a bounded complete repair list for ${ISSUE_URL}`, async () => {
        const modal = new SkillLoadIssuesModal(new App(), [makeIssue()]);
        modal.contentEl.empty = () => modal.contentEl.replaceChildren();

        await act(async () => ReactModal.prototype.onOpen.call(modal));

        const list = modal.contentEl.querySelector(".skill-load-list");
        expect(list?.classList.contains("skill-load-list")).toBe(true);
        expect(within(modal.contentEl).getByText(makeIssue().name)).not.toBeNull();
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});

function makeIssue(overrides: Partial<SkillLoadIssue> = {}): SkillLoadIssue {
  return {
    name: "broken-skill",
    location: ".claude/skills/broken-skill/",
    reason: 'The description contains ": " and must be quoted.',
    suggestion: 'description: "Use this skill for: reviewing notes"',
    revealLabel: "Show in folder",
    onOpen: jest.fn(),
    onReveal: jest.fn(),
    ...overrides,
  };
}
