import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { SettingsSubPageLayout } from "./SettingsSubPageLayout";

function renderLayout(onBack: () => void = jest.fn()) {
  return render(
    <SettingsSubPageLayout
      title="Approved rules"
      description="Actions Claude may take without asking."
      toolbar={<input aria-label="Search rules" />}
      footer={<p>Don&apos;t see your service?</p>}
      onBack={onBack}
    >
      <ul aria-label="Rules">
        {Array.from({ length: 50 }, (_, i) => (
          <li key={i}>Rule {i + 1}</li>
        ))}
      </ul>
    </SettingsSubPageLayout>
  );
}

describe("SettingsSubPageLayout", () => {
  describe("SettingsSubPageLayout()", () => {
    it("shows Back, the title and the description, and calls onBack when Back is pressed", () => {
      const onBack = jest.fn();
      renderLayout(onBack);

      expect(screen.getByRole("heading", { name: "Approved rules" })).not.toBeNull();
      expect(screen.getByText("Actions Claude may take without asking.")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("moves focus to Back when the page opens, so keyboard users land inside the page that replaced the settings", () => {
      renderLayout();

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/874 puts only the body in a scrolling region that fills the remaining height, keeping Back, title, toolbar and footer outside it so they stay in view", () => {
      renderLayout();
      const body = screen.getByRole("region", { name: "Approved rules" });

      expect(body.className).toEqual(expect.stringContaining("tw-overflow-y-auto"));
      expect(body.className).toEqual(expect.stringContaining("tw-flex-1"));
      expect(body.className).toEqual(expect.stringContaining("tw-min-h-0"));
      expect(body.contains(screen.getByRole("list", { name: "Rules" }))).toBe(true);
      expect(screen.getAllByRole("listitem")).toHaveLength(50);
      for (const fixed of [
        screen.getByRole("button", { name: "Back" }),
        screen.getByRole("heading", { name: "Approved rules" }),
        screen.getByRole("textbox", { name: "Search rules" }),
        screen.getByText("Don't see your service?"),
      ]) {
        expect(body.contains(fixed)).toBe(false);
      }
    });
  });
});
