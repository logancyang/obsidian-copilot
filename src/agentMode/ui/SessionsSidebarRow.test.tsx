import {
  SessionsSidebarRow,
  resolveSessionStatus,
  type SessionStatus,
} from "@/agentMode/ui/SessionsSidebarRow";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderRow(overrides: Partial<React.ComponentProps<typeof SessionsSidebarRow>> = {}) {
  const props = {
    title: "Plan the fall launch",
    status: "idle" as SessionStatus,
    active: false,
    onSelect: jest.fn(),
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
      ["unread", "Unread result"],
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
  });

  describe("resolveSessionStatus()", () => {
    it.each([
      [{ waiting: true, unread: true, running: true }, "waiting"],
      [{ waiting: false, unread: true, running: true }, "unread"],
      [{ waiting: false, unread: false, running: true }, "running"],
      [{ waiting: false, unread: false, running: false }, "idle"],
    ] as const)("resolves %j to %s so the most urgent status wins", (flags, expected) => {
      expect(resolveSessionStatus(flags)).toBe(expected);
    });
  });
});
