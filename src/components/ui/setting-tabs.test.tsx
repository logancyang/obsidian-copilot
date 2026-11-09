import { TabItem } from "@/components/ui/setting-tabs";
import { render, screen } from "@testing-library/react";
import React from "react";

const baseProps = {
  isSelected: false,
  onClick: jest.fn(),
};

describe("setting-tabs", () => {
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
