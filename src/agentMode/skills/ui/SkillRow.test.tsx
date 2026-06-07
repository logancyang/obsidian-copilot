import { AppContext } from "@/context";
import type { Skill } from "@/agentMode/skills/types";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";
import { SkillRow } from "./SkillRow";

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

describe("SkillRow overflow menu", () => {
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
