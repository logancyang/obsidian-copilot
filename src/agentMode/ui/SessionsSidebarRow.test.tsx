import {
  SessionsSidebarRow,
  resolveSessionStatus,
  type SessionStatus,
} from "@/agentMode/ui/SessionsSidebarRow";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

function renderRow(overrides: Partial<React.ComponentProps<typeof SessionsSidebarRow>> = {}) {
  const props = {
    title: "Plan the fall launch",
    status: "idle" as SessionStatus,
    active: false,
    isSessionOpen: false,
    onSelect: jest.fn(),
    onCloseSession: jest.fn(),
    ...overrides,
  };
  render(<SessionsSidebarRow {...props} />);
  return props;
}

describe("SessionsSidebarRow", () => {
  describe("SessionsSidebarRow()", () => {
    it("shows the chat title as the row's name and selects the chat on click for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const { onSelect } = renderRow();

      fireEvent.click(screen.getByRole("button", { name: "Plan the fall launch" }));

      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("marks the row as the current chat only when it is active for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ active: true });
      expect(screen.getByRole("button").getAttribute("aria-current")).toBe("true");
    });

    it("leaves the row unmarked when it is not active for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ active: false });
      expect(screen.getByRole("button").hasAttribute("aria-current")).toBe(false);
    });

    it.each([
      ["running", "Running"],
      ["waiting", "Waiting for permission"],
    ] as const)(
      "labels a %s row with its status icon for https://github.com/Brevilabs/obsidian-copilot-private/issues/801",
      (status, label) => {
        renderRow({ status });

        expect(screen.getByLabelText(label)).toBeTruthy();
      }
    );

    it("shows no status icon on an idle row for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ status: "idle" });

      expect(screen.getByRole("button").querySelector("[aria-label]")).toBeNull();
    });

    it("marks an idle chat with a live session with a session-open dot for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true });

      const row = screen.getByRole("button", { name: /Plan the fall launch/ });
      expect(within(row).getByLabelText("Session open")).toBeTruthy();
    });

    it("shows only the more urgent status when a chat with a live session is also running for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true, status: "running" });

      expect(screen.getByLabelText("Running")).toBeTruthy();
      expect(screen.queryByLabelText("Session open")).toBeNull();
    });

    it("bolds the title of a chat with an unseen result and keeps the session-open dot for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true, status: "unread" });

      const row = screen.getByRole("button", { name: /Plan the fall launch/ });
      expect(within(row).getByLabelText("Unread result")).toBeTruthy();
      expect(within(row).getByText("Plan the fall launch").className).toContain("tw-font-semibold");
      expect(within(row).getByLabelText("Session open")).toBeTruthy();
    });

    it("shows a seen chat's title at normal weight for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true });

      expect(screen.getByText("Plan the fall launch").className).not.toContain("tw-font-semibold");
    });

    it("places the status at the row's right end, after the title, for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: true, status: "waiting" });

      const row = screen.getByRole("button", { name: /Plan the fall launch/ });
      const title = within(row).getByText("Plan the fall launch");
      const status = within(row).getByLabelText("Waiting for permission");
      expect(title.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(row.querySelector(".tw-order-first")).toBeNull();
    });

    it("closes the live session from the row's right end without opening the chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const { onSelect, onCloseSession } = renderRow({ isSessionOpen: true });

      fireEvent.click(screen.getByRole("button", { name: "Close chat" }));

      expect(onCloseSession).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("offers no close button when the chat has no live session for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      renderRow({ isSessionOpen: false, status: "unread" });

      expect(screen.queryByRole("button", { name: "Close chat" })).toBeNull();
      expect(screen.queryByLabelText("Session open")).toBeNull();
    });
  });

  describe("resolveSessionStatus()", () => {
    it.each([
      [{ waiting: true, unread: true, running: true }, "waiting"],
      [{ waiting: false, unread: true, running: true }, "running"],
      [{ waiting: false, unread: true, running: false }, "unread"],
      [{ waiting: false, unread: false, running: false }, "idle"],
    ] as const)("resolves %j to %s so the most urgent status wins", (flags, expected) => {
      expect(resolveSessionStatus(flags)).toBe(expected);
    });
  });
});
