import { TabItem } from "@/components/ui/setting-tabs";
import { render, screen } from "@testing-library/react";
import React from "react";

const baseProps = {
  isSelected: false,
  onClick: jest.fn(),
  isFirst: false,
  isLast: false,
};

describe("setting-tabs", () => {
  describe("TabItem()", () => {
    it("shows an accessible top-right warning dot when the tab carries a warning for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
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
      const dot = screen.getByTitle("Some skills failed to load");
      expect(dot.classList.contains("tw-absolute")).toBe(true);
      expect(dot.classList.contains("tw-right-1")).toBe(true);
      expect(dot.classList.contains("tw-top-1")).toBe(true);
      expect(dot.classList.contains("tw-rounded-full")).toBe(true);
      expect(dot.classList.contains("tw-bg-warning")).toBe(true);
    });

    it("does not show a warning dot when the tab has no warning", () => {
      render(<TabItem {...baseProps} tab={{ id: "skills", label: "Skills", icon: null }} />);

      expect(screen.getByRole("tab", { name: "Skills" })).not.toBeNull();
      expect(screen.queryByTitle("Some skills failed to load")).toBeNull();
    });
  });
});
