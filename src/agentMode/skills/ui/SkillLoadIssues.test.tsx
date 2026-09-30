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
    it(`keeps rejected skills compact and links to their details for ${ISSUE_URL}`, () => {
      const onViewDetails = jest.fn();
      render(<SkillLoadIssues issues={[makeIssue()]} onViewDetails={onViewDetails} />);

      expect(screen.getByRole("alert", { name: "1 skill could not be loaded" })).not.toBeNull();
      expect(screen.getByText("The skills have format errors.")).not.toBeNull();
      expect(screen.queryByText(makeIssue().location)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      expect(onViewDetails).toHaveBeenCalledTimes(1);
    });
  });

  describe("SkillLoadIssuesModalContent()", () => {
    let restoreContentHeight: (() => void) | undefined;

    afterEach(() => {
      restoreContentHeight?.();
      restoreContentHeight = undefined;
    });

    it(`lists each rejected skill's file path, reason, and rejected line in its own article for ${ISSUE_URL}`, () => {
      render(
        <SkillLoadIssuesModalContent
          issues={[
            makeIssue(),
            makeIssue({
              location: ".claude/skills/without-fix/SKILL.md",
              offendingText: "description: [unfinished",
            }),
            makeIssue({
              location: ".claude/skills/third/SKILL.md",
              reason: "Missing name.",
              offendingText: undefined,
            }),
          ]}
          onFixAll={jest.fn()}
          onClose={jest.fn()}
        />
      );

      expect(screen.getAllByRole("article")).toHaveLength(3);
      expect(screen.getByText(makeIssue().location)).not.toBeNull();
      expect(screen.getByText(makeIssue().offendingText as string)).not.toBeNull();
      expect(screen.getByText(".claude/skills/without-fix/SKILL.md")).not.toBeNull();
      expect(screen.getByText("description: [unfinished")).not.toBeNull();
      expect(screen.getAllByText(makeIssue().reason)).toHaveLength(2);
      expect(screen.getByText("Missing name.")).not.toBeNull();
    });

    it(`closes the modal before running a row action or Fix All for ${ISSUE_URL}`, () => {
      const order: string[] = [];
      render(
        <SkillLoadIssuesModalContent
          issues={[
            makeIssue({
              onFixWithAgent: () => order.push("fix"),
              onOpen: () => order.push("open"),
              onReveal: () => order.push("reveal"),
            }),
            makeIssue({ location: ".claude/skills/second/SKILL.md" }),
          ]}
          onFixAll={() => order.push("fix-all")}
          onClose={() => order.push("close")}
        />
      );

      fireEvent.click(screen.getAllByRole("button", { name: "Fix with Agent" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "Open SKILL.md" })[0]);
      fireEvent.click(screen.getAllByRole("button", { name: "Show in folder" })[0]);
      fireEvent.click(screen.getByRole("button", { name: "Fix All with Agent" }));

      expect(order).toEqual([
        "close",
        "fix",
        "close",
        "open",
        "close",
        "reveal",
        "close",
        "fix-all",
      ]);
    });

    it(`collapses an overflowing rejected description until Show more is selected for ${ISSUE_URL}`, () => {
      restoreContentHeight = stubContentDimensions(400, 100);
      const longDescription = `description: ${"Review long notes carefully. ".repeat(40)}`;

      render(
        <SkillLoadIssuesModalContent
          issues={[makeIssue({ offendingText: longDescription })]}
          onFixAll={jest.fn()}
          onClose={jest.fn()}
        />
      );

      const preview = screen.getByTestId("clamped-content");
      expect(preview.classList.contains("tw-max-h-28")).toBe(true);
      expect(preview.textContent).toBe(longDescription);

      fireEvent.click(screen.getByRole("button", { name: "Show more" }));

      expect(preview.classList.contains("tw-max-h-28")).toBe(false);
      expect(screen.getByRole("button", { name: "Show less" })).not.toBeNull();
    });
  });

  describe("SkillLoadIssuesModal", () => {
    describe("constructor()", () => {
      it(`uses truthful singular native title copy for ${ISSUE_URL}`, () => {
        const modal = new SkillLoadIssuesModal(new App(), [makeIssue()], jest.fn());

        expect(modal.titleEl.textContent).toBe("1 skill could not be loaded");
      });
    });

    describe("onOpen()", () => {
      it(`renders the complete repair list for ${ISSUE_URL}`, async () => {
        const modal = new SkillLoadIssuesModal(new App(), [makeIssue()], jest.fn());
        modal.contentEl.empty = () => modal.contentEl.replaceChildren();

        await act(async () => ReactModal.prototype.onOpen.call(modal));

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
    onFixWithAgent: jest.fn(),
    onOpen: jest.fn(),
    onReveal: jest.fn(),
    ...overrides,
  };
}
