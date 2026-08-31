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

function stubContentDimensions(scrollHeightPx: number, clientHeightPx: number): () => void {
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight"
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  );
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeightPx,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeightPx,
  });
  return () => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  };
}

describe("SkillLoadIssues", () => {
  describe("SkillLoadIssues()", () => {
    it(`keeps one rejected skill compact while surfacing its high-level cause for ${ISSUE_URL}`, () => {
      const onViewDetails = jest.fn();
      render(<SkillLoadIssues issues={[makeIssue()]} onViewDetails={onViewDetails} />);

      expect(screen.getByRole("alert", { name: "1 skill could not be loaded" })).not.toBeNull();
      expect(
        screen.getByText("Not available to agents. The description is not quoted.")
      ).not.toBeNull();
      expect(screen.getByText("1 skill could not be loaded").parentElement?.className).toBe(
        "skill-load-copy"
      );
      expect(screen.getByRole("button", { name: "View details" }).parentElement?.className).toBe(
        "skill-load-actions"
      );
      expect(screen.queryByText(makeIssue().location)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      expect(onViewDetails).toHaveBeenCalledTimes(1);
    });

    it(`collapses a shared cause into one explanation for ${ISSUE_URL}`, () => {
      render(
        <SkillLoadIssues
          issues={[makeIssue(), makeIssue({ location: ".claude/skills/second/SKILL.md" })]}
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
              location: ".claude/skills/second/SKILL.md",
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
    let restoreContentHeight: (() => void) | undefined;

    afterEach(() => {
      restoreContentHeight?.();
      restoreContentHeight = undefined;
    });

    it(`shows every file path, reason, and rejected line for ${ISSUE_URL}`, () => {
      const order: string[] = [];
      render(
        <SkillLoadIssuesModalContent
          issues={[
            makeIssue({
              onOpen: () => order.push("open"),
              onReveal: () => order.push("reveal"),
            }),
            makeIssue({
              location: ".claude/skills/without-fix/SKILL.md",
              offendingText: "description: [unfinished",
            }),
          ]}
          onClose={() => order.push("close")}
        />
      );

      expect(screen.getByText(makeIssue().location)).not.toBeNull();
      expect(screen.getByText(makeIssue().location).tagName).toBe("DIV");
      expect(screen.getByText(makeIssue().offendingText as string)).not.toBeNull();
      expect(screen.getByText(".claude/skills/without-fix/SKILL.md")).not.toBeNull();
      expect(screen.getAllByText(makeIssue().reason)).toHaveLength(2);
      expect(screen.queryByText("Current")).toBeNull();
      expect(screen.queryByText("Change to")).toBeNull();

      fireEvent.click(screen.getAllByRole("button", { name: "Open SKILL.md" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "Show in folder" })[0]);
      expect(order).toEqual(["close", "open", "close", "reveal"]);
    });

    it(`keeps each explanation attached to its own file for ${ISSUE_URL}`, () => {
      render(
        <SkillLoadIssuesModalContent
          issues={[
            makeIssue(),
            makeIssue({ location: ".claude/skills/second/SKILL.md" }),
            makeIssue({
              location: ".claude/skills/third/SKILL.md",
              reason: "Missing name.",
              offendingText: undefined,
            }),
          ]}
          onClose={jest.fn()}
        />
      );

      expect(screen.getAllByText(makeIssue().reason)).toHaveLength(2);
      expect(screen.getByText("Missing name.")).not.toBeNull();
      expect(screen.getAllByRole("article")).toHaveLength(3);
    });

    it(`collapses an overflowing rejected description until Show more is selected for ${ISSUE_URL}`, () => {
      restoreContentHeight = stubContentDimensions(400, 100);
      const longDescription = `description: ${"Review long notes carefully. ".repeat(40)}`;

      render(
        <SkillLoadIssuesModalContent
          issues={[makeIssue({ offendingText: longDescription })]}
          onClose={jest.fn()}
        />
      );

      const preview = screen.getByTestId("clamped-content");
      expect(preview.classList.contains("tw-max-h-[6lh]")).toBe(true);
      expect(preview.textContent).toBe(longDescription);

      fireEvent.click(screen.getByRole("button", { name: "Show more" }));

      expect(preview.classList.contains("tw-max-h-[6lh]")).toBe(false);
      expect(screen.getByRole("button", { name: "Show less" })).not.toBeNull();
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
        expect(within(modal.contentEl).getByText(makeIssue().location)).not.toBeNull();
        await act(async () => ReactModal.prototype.onClose.call(modal));
      });
    });
  });
});

function makeIssue(overrides: Partial<SkillLoadIssue> = {}): SkillLoadIssue {
  return {
    location: ".claude/skills/broken-skill/SKILL.md",
    reason: 'The description contains ": " and must be quoted.',
    offendingText: "description: Use this skill for: reviewing notes",
    revealLabel: "Show in folder",
    onOpen: jest.fn(),
    onReveal: jest.fn(),
    ...overrides,
  };
}
