import { SessionsSidebarFolderRow } from "@/agentMode/navigator/ui/SessionsSidebarFolderRow";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import { sidebarProject } from "@/agentMode/navigator/ui/testing/sessionsSidebarFixtures";
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
    it("only folds or unfolds the folder when the project row is clicked for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const { onToggle, onNewChat } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "Garden plans" }));

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onNewChat).not.toHaveBeenCalled();
    });

    it.each([
      [true, "true"],
      [false, "false"],
    ])("reports expanded=%s to assistive tech", (expanded, ariaExpanded) => {
      renderFolderRow({ expanded });

      expect(
        screen.getByRole("button", { name: "Garden plans" }).getAttribute("aria-expanded")
      ).toBe(ariaExpanded);
    });

    it("starts a chat in the project from the hover plus without folding the folder for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onNewChat, onToggle } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "New chat in Garden plans" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
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

    it("bolds the folder name when a hidden chat has an unseen result for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      renderFolderRow({ hiddenStatus: "unread" });

      expect(screen.getByText("Garden plans").className).toContain("tw-font-semibold");
    });

    it("keeps the bubbled status's space and overlays the chevron on it, so hovering moves nothing, for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      renderFolderRow({ hiddenStatus: "waiting" });

      const row = screen.getByText("Garden plans").closest("button")!;
      const statusSlot = screen.getByLabelText("Waiting for permission").parentElement!;
      expect(statusSlot.className).toContain("group-hover:tw-invisible");
      expect(statusSlot.className).not.toContain("group-hover:tw-hidden");
      expect(row.querySelector(".lucide-chevron-right")!.getAttribute("class")).toContain(
        "tw-absolute"
      );
    });

    it("shows no status when nothing hidden needs the user", () => {
      renderFolderRow({ hiddenStatus: "idle" });

      expect(
        screen.getByRole("button", { name: "Garden plans" }).querySelector("[aria-label]")
      ).toBeNull();
    });

    it("opens the project menu from the context menu gesture without toggling the folder", () => {
      const { onToggle } = renderFolderRow();

      fireEvent.contextMenu(screen.getByRole("button", { name: "Garden plans" }));

      expect(screen.getByRole("menu")).toBeTruthy();
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
