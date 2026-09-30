import { AppContext } from "@/context";
import type { Skill } from "@/agentMode/skills/types";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";
import { SkillRow } from "./SkillRow";

const getEffectiveSkillsFolder = jest.fn(() => "copilot/skills");
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveSkillsFolder: () => getEffectiveSkillsFolder(),
}));

const resolveCanonicalNameForMigration = jest.fn((name: string) => name);
const getSuppressMigrationConfirm = jest.fn(() => false);
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      resolveCanonicalNameForMigration: (name: string) => resolveCanonicalNameForMigration(name),
      getSuppressMigrationConfirm: () => getSuppressMigrationConfirm(),
      consolidateMirroredSkill: jest.fn(),
    }),
  },
}));

let lastMigrateModalOptions: { actionLines: { verb: string; detail: string }[] } | null = null;
jest.mock("./MigrateSkillConfirmModal", () => ({
  MigrateSkillConfirmModal: class {
    constructor(_app: unknown, options: { actionLines: { verb: string; detail: string }[] }) {
      lastMigrateModalOptions = options;
    }
    open = jest.fn();
  },
}));

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  if (!("PointerEvent" in window)) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const SCROLL_LOCK_ATTR = "data-scroll-locked";

const canonicalSkill: Skill = {
  name: "writing-helper",
  description: "Helps with writing.",
  filePath: "/vault/.copilot/skills/writing-helper/SKILL.md",
  dirPath: "/vault/.copilot/skills/writing-helper",
  body: "",
  enabledAgents: [],
  location: { kind: "canonical" },
};

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText(/More actions/i), { button: 0, ctrlKey: false });
}

function renderRow(onRevealInVault: () => void) {
  const containerRef: React.RefObject<HTMLDivElement> = { current: null };
  const utils = render(
    <AppContext.Provider value={{} as App}>
      <div ref={containerRef} />
      <SkillRow
        skill={canonicalSkill}
        agents={[]}
        agentDirsProjectRel={{}}
        onRevealInVault={onRevealInVault}
        containerRef={containerRef}
      />
    </AppContext.Provider>
  );
  return { ...utils, containerRef };
}

const mirroredSkill: Skill = {
  name: "writing-helper",
  description: "Helps with writing.",
  filePath: "/vault/.claude/skills/writing-helper/SKILL.md",
  dirPath: "/vault/.claude/skills/writing-helper",
  body: "",
  enabledAgents: [],
  location: { kind: "project", agentDirs: ["claude", "codex"] },
};

function renderMirroredRow() {
  const containerRef: React.RefObject<HTMLDivElement> = { current: null };
  return render(
    <AppContext.Provider value={{} as App}>
      <div ref={containerRef} />
      <SkillRow
        skill={mirroredSkill}
        agents={[]}
        agentDirsProjectRel={{ claude: ".claude/skills", codex: ".codex/skills" }}
        onRevealInVault={() => {}}
        containerRef={containerRef}
      />
    </AppContext.Provider>
  );
}

describe("SkillRow", () => {
  describe("SkillRow()", () => {
    afterEach(() => {
      activeDocument.body.removeAttribute(SCROLL_LOCK_ATTR);
      lastMigrateModalOptions = null;
    });

    it("lists Reveal in vault in the overflow menu without engaging a body scroll lock", () => {
      renderRow(() => {});

      openMenu();

      expect(screen.getByText("Reveal in vault")).not.toBeNull();
      expect(activeDocument.body.hasAttribute(SCROLL_LOCK_ATTR)).toBe(false);
    });

    it("invokes the reveal handler when Reveal in vault is selected", () => {
      const onRevealInVault = jest.fn();
      renderRow(onRevealInVault);

      openMenu();
      fireEvent.click(screen.getByText("Reveal in vault"));

      expect(onRevealInVault).toHaveBeenCalledTimes(1);
    });

    it("confirms migration into the folder derived from the Copilot root, not the retired skills field", () => {
      getEffectiveSkillsFolder.mockReturnValue("team/copilot/skills");
      renderMirroredRow();

      openMenu();
      fireEvent.click(screen.getByText("Migrate to shared folder"));

      const moveLine = lastMigrateModalOptions?.actionLines.find((line) => line.verb === "Move");
      expect(moveLine?.detail).toContain("<vault>/team/copilot/skills/writing-helper/");
    });
  });
});
