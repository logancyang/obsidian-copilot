import { TabProvider, useTab } from "@/contexts/TabContext";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const TabProbe: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  return (
    <button type="button" onClick={() => setSelectedTab("skills")}>
      {selectedTab}
    </button>
  );
};

describe("TabContext", () => {
  describe("TabProvider()", () => {
    it("selects Basic for an ordinary settings render", () => {
      render(
        <TabProvider>
          <TabProbe />
        </TabProvider>
      );

      expect(screen.getByText("basic")).toBeTruthy();
    });

    it("selects the requested initial tab for a direct handoff (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(
        <TabProvider initialTab="advanced">
          <TabProbe />
        </TabProvider>
      );

      expect(screen.getByText("advanced")).toBeTruthy();
    });
  });

  describe("useTab()", () => {
    it("exposes the current tab and its selector", () => {
      render(
        <TabProvider>
          <TabProbe />
        </TabProvider>
      );

      fireEvent.click(screen.getByRole("button", { name: "basic" }));

      expect(screen.getByRole("button", { name: "skills" })).toBeTruthy();
    });
  });
});
