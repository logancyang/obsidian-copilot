import { AppContext } from "@/context";
import type { Skill } from "@/agentMode/skills/types";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";
import { SkillRow } from "./SkillRow";

// The migration/consolidate paths resolve the destination from the derived
// skills folder. Mock the accessor so a test can assert the confirm dialog
// shows the derived path (and not the retired agentMode.skills.folder).
const getEffectiveSkillsFolder = jest.fn(() => "copilot/skills");
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveSkillsFolder: () => getEffectiveSkillsFolder(),
}));

// Narrow SkillManager mock: only the members the consolidate path reads before
// opening the confirm dialog. No disk, no real migration.
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

// Capture the options the consolidate flow passes to the confirm modal so the
// test can inspect the action lines without opening a real Obsidian modal.
let lastMigrateModalOptions: { actionLines: { verb: string; detail: string }[] } | null = null;
jest.mock("./MigrateSkillConfirmModal", () => ({
  MigrateSkillConfirmModal: class {
    constructor(_app: unknown, options: { actionLines: { verb: string; detail: string }[] }) {
      lastMigrateModalOptions = options;
    }
    open = jest.fn();
  },
}));

// Radix DropdownMenu portals resolve `activeDocument` at render time, and its
// trigger relies on Pointer Capture + PointerEvent, neither of which jsdom
// implements. Polyfill the minimum so the menu can actually open in the test.
beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  if (!("PointerEvent" in window)) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// react-remove-scroll-bar marks an active body scroll lock by stamping this
// attribute (a use-counter) on <body>. Radix engages it only when the menu is
// modal — which is exactly the state issue #118 must avoid.
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

// Radix's DropdownMenuTrigger opens on primary-button pointerDown, not click.
function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText(/More actions/i), { button: 0, ctrlKey: false });
}

function renderRow(onRevealInVault: () => void) {
  // A plain ref object rather than useRef — renderRow is a helper, not a hook context.
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

describe("SkillRow", () => {
  describe("overflow menu", () => {
    afterEach(() => {
      activeDocument.body.removeAttribute(SCROLL_LOCK_ATTR);
    });

    // Regression guard for issue #118: a modal dropdown engages
    // react-remove-scroll's document-level wheel listener. "Reveal in vault"
    // moves focus into the file-explorer leaf, which can interrupt the menu's
    // close/unmount and strand that listener, killing wheel scrolling vault-wide
    // until restart. Keeping the menu non-modal means the lock is never engaged.
    it("does not engage a body scroll lock when the menu opens", () => {
      renderRow(() => {});

      openMenu();

      // The menu is open (its items are mounted)…
      expect(screen.getByText("Reveal in vault")).not.toBeNull();
      // …but the body must not be scroll-locked.
      expect(activeDocument.body.hasAttribute(SCROLL_LOCK_ATTR)).toBe(false);
    });

    it("invokes the reveal handler when Reveal in vault is selected", () => {
      const onRevealInVault = jest.fn();
      renderRow(onRevealInVault);

      openMenu();
      fireEvent.click(screen.getByText("Reveal in vault"));

      expect(onRevealInVault).toHaveBeenCalledTimes(1);
    });
  });

  describe("migrate-to-shared-folder confirmation", () => {
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

    afterEach(() => {
      lastMigrateModalOptions = null;
    });

    it("targets the folder derived from the Copilot root, not the retired skills field", () => {
      // Regression: the confirm dialog's Move line must point at the derived
      // skills folder. A non-default root exposed the bug — the old resolver read
      // agentMode.skills.folder, which no longer tracks the root.
      getEffectiveSkillsFolder.mockReturnValue("team/copilot/skills");
      renderMirroredRow();

      openMenu();
      fireEvent.click(screen.getByText("Migrate to shared folder"));

      const moveLine = lastMigrateModalOptions?.actionLines.find((line) => line.verb === "Move");
      expect(moveLine?.detail).toContain("<vault>/team/copilot/skills/writing-helper/");
    });
  });
});
