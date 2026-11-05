import { SessionsSidebarFolderRow } from "@/agentMode/navigator/ui/SessionsSidebarFolderRow";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import { sidebarProject } from "@/agentMode/navigator/ui/testing/sessionsSidebarFixtures";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    onOpen: jest.fn(),
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
    it("opens the project's home on a click of the project row without folding or unfolding it for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      const { onOpen, onToggle, onNewChat } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "Garden plans" }));

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
      expect(onNewChat).not.toHaveBeenCalled();
    });

    it.each([
      [false, "Show chats in Garden plans"],
      [true, "Hide chats in Garden plans"],
    ])(
      "folds or unfolds the project from its chevron (expanded=%s) without opening the project for https://github.com/Brevilabs/obsidian-copilot-private/issues/840",
      (expanded, label) => {
        const { onOpen, onToggle } = renderFolderRow({ expanded });

        fireEvent.click(screen.getByRole("button", { name: label }));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
      }
    );

    it.each([
      [true, "true"],
      [false, "false"],
    ])(
      "reports expanded=%s to assistive tech on the chevron, not on the row",
      (expanded, ariaExpanded) => {
        renderFolderRow({ expanded });

        expect(
          screen
            .getByRole("button", { name: /chats in Garden plans$/ })
            .getAttribute("aria-expanded")
        ).toBe(ariaExpanded);
        expect(
          screen.getByRole("button", { name: "Garden plans" }).hasAttribute("aria-expanded")
        ).toBe(false);
      }
    );

    it("starts a chat in the project from the hover plus without folding the folder for https://github.com/Brevilabs/obsidian-copilot-private/issues/803", () => {
      const { onNewChat, onToggle, onOpen } = renderFolderRow();

      fireEvent.click(screen.getByRole("button", { name: "New chat in Garden plans" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
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

      const statusSlot = screen.getByLabelText("Waiting for permission").parentElement!;
      expect(statusSlot.className).toContain("group-hover:tw-invisible");
      expect(statusSlot.className).not.toContain("group-hover:tw-hidden");
      expect(
        screen.getByRole("button", { name: "Show chats in Garden plans" }).className
      ).toContain("tw-absolute");
    });

    it.each([
      [
        "keeps the status and hides the chevron and actions after a mouse click focuses the row",
        false,
      ],
      ["lays the chevron and actions over the status when the keyboard focuses the row", true],
    ])(
      "%s for https://github.com/Brevilabs/obsidian-copilot-private/issues/802",
      (_title, keyboardFocus) => {
        const revealed = keyboardFocus;
        renderFolderRow({ hiddenStatus: "waiting" });
        const row = screen.getByText("Garden plans").closest("button")!;
        jest.spyOn(row, "matches").mockReturnValue(keyboardFocus);

        act(() => row.focus());

        const statusSlot = screen.getByLabelText("Waiting for permission").parentElement!;
        const chevron = screen.getByRole("button", { name: "Show chats in Garden plans" });
        const actions = screen.getByRole("button", {
          name: "More actions for Garden plans",
        }).parentElement!;
        expect(statusSlot.classList.contains("tw-invisible")).toBe(revealed);
        expect(chevron.classList.contains("tw-visible")).toBe(revealed);
        expect(actions.classList.contains("tw-visible")).toBe(revealed);
      }
    );

    it("keeps the chevron shown while the keyboard focuses the chevron itself for https://github.com/Brevilabs/obsidian-copilot-private/issues/840", () => {
      renderFolderRow();
      const chevron = screen.getByRole("button", { name: "Show chats in Garden plans" });
      jest.spyOn(chevron, "matches").mockReturnValue(true);

      act(() => chevron.focus());

      expect(document.activeElement).toBe(chevron);
      expect(chevron.classList.contains("tw-visible")).toBe(true);
    });

    it("shows no status when nothing hidden needs the user", () => {
      renderFolderRow({ hiddenStatus: "idle" });

      expect(
        screen.getByRole("button", { name: "Garden plans" }).querySelector("[aria-label]")
      ).toBeNull();
    });

    it("opens the project menu from the context menu gesture without toggling or opening the project", () => {
      const { onToggle, onOpen } = renderFolderRow();

      fireEvent.contextMenu(screen.getByRole("button", { name: "Garden plans" }));

      expect(screen.getByRole("menu")).toBeTruthy();
      expect(onToggle).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
    });
  });
});
