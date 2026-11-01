import { SessionsSidebarFolderRow } from "@/agentMode/ui/SessionsSidebarFolderRow";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import { sidebarProject } from "@/agentMode/ui/testing/sessionsSidebarFixtures";
import { AppContext } from "@/context";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

function renderFolderRow(
  overrides: Partial<React.ComponentProps<typeof SessionsSidebarFolderRow>> = {}
) {
  const props = {
    project: sidebarProject("garden", "Garden plans"),
    expanded: false,
    active: false,
    hiddenStatus: "idle" as const,
    onToggle: jest.fn(),
    onOpen: jest.fn(),
    onNewChat: jest.fn(),
    onDeleted: jest.fn(),
    ...overrides,
  };
  render(
    <AppContext.Provider value={new App()}>
      <SessionsSidebarFolderRow {...props} />
    </AppContext.Provider>
  );
  return props;
}

describe("SessionsSidebarFolderRow", () => {
  beforeAll(installRadixMenuPolyfills);

  describe("SessionsSidebarFolderRow()", () => {
    it("opens the project on a click of its name without toggling the folder for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onOpen, onToggle } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "Garden plans" }));

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("toggles the folder from the chevron alone without opening the project for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onOpen, onToggle } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "Expand Garden plans" }));

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it.each([
      [true, "Collapse Garden plans"],
      [false, "Expand Garden plans"],
    ])("labels the chevron for expanded=%s", (expanded, label) => {
      renderFolderRow({ expanded });

      expect(screen.getByRole("button", { name: label }).getAttribute("aria-expanded")).toBe(
        String(expanded)
      );
    });

    it("starts a chat in the project from the hover plus without opening the project twice for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onNewChat, onOpen, onToggle } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "New chat in Garden plans" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it.each([
      [true, "true"],
      [false, undefined],
    ])("marks the row current when active=%s", (active, current) => {
      renderFolderRow({ active });

      expect(
        screen.getByRole("button", { name: "Garden plans" }).getAttribute("aria-current") ??
          undefined
      ).toBe(current);
    });

    it.each([
      ["running", "Running"],
      ["waiting", "Waiting for permission"],
      ["unread", "Unread result"],
    ] as const)(
      "shows the %s status of a chat hidden inside the folder on the folder row for https://github.com/Brevilabs/obsidian-copilot-private/issues/802",
      (hiddenStatus, label) => {
        renderFolderRow({ hiddenStatus });

        expect(screen.getByLabelText(label)).toBeTruthy();
      }
    );

    it("shows no status when nothing hidden needs the user", () => {
      renderFolderRow({ hiddenStatus: "idle" });

      expect(
        screen.getByRole("button", { name: "Garden plans" }).querySelector("[aria-label]")
      ).toBeNull();
    });

    it("opens the project menu from the context menu gesture without toggling the folder", () => {
      const { onOpen, onToggle } = renderFolderRow();

      fireEvent.contextMenu(screen.getByRole("button", { name: "Garden plans" }));

      expect(screen.getByRole("menu")).toBeTruthy();
      expect(onToggle).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
    });
  });
});
