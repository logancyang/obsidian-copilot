import {
  SettingTabStrip,
  TabItem,
  type TabItem as TabItemType,
} from "@/components/ui/setting-tabs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const ISSUE_891 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/891";

const baseProps = {
  isSelected: false,
  onClick: jest.fn(),
};

const STRIP_TABS: TabItemType[] = [
  { id: "basic", label: "Basic", icon: null },
  { id: "byok", label: "BYOK", icon: null },
  { id: "miyo", label: "Miyo", icon: null },
  {
    id: "skills",
    label: "Skills",
    icon: null,
    warningLabel: "Some skills failed to load",
  },
  {
    id: "connectors",
    label: "Connectors",
    icon: null,
    warningLabel: "You have connectors that need your attention",
    warningTone: "error",
  },
];

const TAB_WIDTH = 80;
const OVERFLOW_BUTTON_WIDTH = 32;

function stubStripWidth(stripWidth: number) {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const width =
      this.getAttribute("role") === "tablist"
        ? stripWidth
        : this.querySelector('[role="tab"]')
          ? TAB_WIDTH
          : this.querySelector("button")
            ? OVERFLOW_BUTTON_WIDTH
            : 0;
    return { width } as DOMRect;
  });
}

function visibleTabNames() {
  return screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));
}

function openOverflowMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, ctrlKey: false });
}

describe("setting-tabs", () => {
  beforeAll(() => {
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("SettingTabStrip()", () => {
    it("shows every tab in one row without an overflow button when they all fit", () => {
      stubStripWidth(1000);
      render(<SettingTabStrip tabs={STRIP_TABS} selectedId="basic" onSelect={jest.fn()} />);

      expect(visibleTabNames()).toEqual([
        "Basic",
        "BYOK",
        "Miyo",
        "Skills: Some skills failed to load",
        "Connectors: You have connectors that need your attention",
      ]);
      expect(screen.queryByRole("button", { name: /more tab/ })).toBeNull();
    });

    it(`moves tabs that don't fit into an overflow menu that selects them for ${ISSUE_891}`, () => {
      stubStripWidth(300);
      const onSelect = jest.fn();
      render(<SettingTabStrip tabs={STRIP_TABS} selectedId="basic" onSelect={onSelect} />);

      expect(visibleTabNames()).toEqual(["Basic", "BYOK", "Miyo"]);
      openOverflowMenu("Show 2 more tabs");
      fireEvent.click(
        screen.getByRole("menuitem", {
          name: "Connectors: You have connectors that need your attention",
        })
      );

      expect(onSelect).toHaveBeenCalledWith("connectors");
    });

    it(`keeps the selected tab in the row by swapping it into the last visible slot for ${ISSUE_891}`, () => {
      stubStripWidth(300);
      render(<SettingTabStrip tabs={STRIP_TABS} selectedId="connectors" onSelect={jest.fn()} />);

      expect(visibleTabNames()).toEqual([
        "Basic",
        "BYOK",
        "Connectors: You have connectors that need your attention",
      ]);
      expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
      openOverflowMenu("Show 2 more tabs");
      expect(
        screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label"))
      ).toEqual(["Miyo", "Skills: Some skills failed to load"]);
    });

    it("shows the most severe warning of overflowed tabs on the overflow button for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
      stubStripWidth(300);
      render(<SettingTabStrip tabs={STRIP_TABS} selectedId="basic" onSelect={jest.fn()} />);

      const dot = within(screen.getByRole("button", { name: "Show 2 more tabs" })).getByTitle(
        "You have connectors that need your attention"
      );
      expect(dot.className).toContain("tw-bg-modifier-error");
    });
  });

  describe("TabItem()", () => {
    it("shows an accessible warning dot when the tab carries a warning for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
      render(
        <TabItem
          {...baseProps}
          tab={{
            id: "skills",
            label: "Skills",
            icon: null,
            warningLabel: "Some skills failed to load",
          }}
        />
      );

      expect(
        screen.getByRole("tab", { name: "Skills: Some skills failed to load" })
      ).not.toBeNull();
      expect(screen.getByTitle("Some skills failed to load")).not.toBeNull();
    });

    it("shows the warning dot in the error color when the tab carries an error-toned warning", () => {
      render(
        <TabItem
          {...baseProps}
          tab={{
            id: "connectors",
            label: "Connectors",
            icon: null,
            warningLabel: "You have connectors that need your attention",
            warningTone: "error",
          }}
        />
      );

      expect(screen.getByTitle("You have connectors that need your attention").className).toContain(
        "tw-bg-modifier-error"
      );
    });

    it("does not show a warning dot when the tab has no warning", () => {
      render(<TabItem {...baseProps} tab={{ id: "skills", label: "Skills", icon: null }} />);

      expect(screen.getByRole("tab", { name: "Skills" })).not.toBeNull();
      expect(screen.queryByTitle("Some skills failed to load")).toBeNull();
    });
  });
});
