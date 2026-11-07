import type {
  CustomConnectorState,
  CustomConnectorStatus,
} from "@/connectors/custom/customConnectors";
import { CustomConnectorRow, customStatusText } from "@/connectors/ui/CustomConnectorRow";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";

function localConnector(status: CustomConnectorStatus): CustomConnectorState {
  return {
    config: { id: "github", name: "GitHub", command: "npx", args: [], envNames: ["TOKEN"] },
    status,
  };
}

function renderRow(status: CustomConnectorStatus) {
  const actions = {
    onEdit: jest.fn(),
    onTryAgain: jest.fn(),
    onSetTurnedOff: jest.fn(),
    onRemove: jest.fn(),
  };
  render(
    <ul>
      <CustomConnectorRow connector={localConnector(status)} {...actions} />
    </ul>
  );
  return { ...actions, row: within(screen.getByRole("listitem", { name: "GitHub" })) };
}

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for GitHub" }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("CustomConnectorRow", () => {
  beforeAll(() => {
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  describe("CustomConnectorRow()", () => {
    it("tags the connector as Custom and counts its tools when it is connected", () => {
      const { row } = renderRow({ kind: "connected", toolCount: 3 });

      expect(row.getByText("Custom")).toBeTruthy();
      expect(row.getByText("3 tools")).toBeTruthy();
      expect(row.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it.each<[CustomConnectorStatus, string]>([
      [{ kind: "connected", toolCount: 1 }, "1 tool"],
      [{ kind: "starting" }, "Starting…"],
      [{ kind: "idle" }, "Starts in your next chat"],
      [
        { kind: "couldnt-start", reason: "FAKE_KEY is not set" },
        "Couldn't start · FAKE_KEY is not set",
      ],
      [{ kind: "unreachable", reason: "HTTP 502" }, "Couldn't reach · HTTP 502"],
      [{ kind: "key-not-accepted" }, "Key not accepted"],
      [{ kind: "needs-key" }, "Add API key on this device"],
      [{ kind: "off" }, "Off on this device"],
    ])("shows the %j status as %s", (status, text) => {
      const { row } = renderRow(status);

      expect(row.getByText(text)).toBeTruthy();
    });

    it.each<[CustomConnectorStatus, string, boolean]>([
      [{ kind: "couldnt-start", reason: "x" }, "Couldn't start · x", true],
      [{ kind: "key-not-accepted" }, "Key not accepted", true],
      [{ kind: "needs-key" }, "Add API key on this device", true],
      [{ kind: "unreachable", reason: "x" }, "Couldn't reach · x", false],
      [{ kind: "off" }, "Off on this device", false],
    ])("colors %j red only when it needs the user (%s: %s)", (status, text, red) => {
      const { row } = renderRow(status);

      const line = row.getByText(text).parentElement?.parentElement;
      expect(line?.className.includes("tw-text-error")).toBe(red);
    });

    it(`keeps a long reason, such as a whole HTTP error page, on one truncated line with the full text on hover: ${ISSUE}`, () => {
      const page = "<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>";
      const { row } = renderRow({ kind: "unreachable", reason: page });

      const reason = row.getByTitle(`Couldn't reach · ${page}`);
      expect(reason.className).toContain("tw-truncate");
    });

    it.each<[CustomConnectorStatus]>([[{ kind: "needs-key" }], [{ kind: "key-not-accepted" }]])(
      "opens Edit from Add API key when the status is %j",
      (status) => {
        const { row, onEdit } = renderRow(status);

        fireEvent.click(row.getByRole("button", { name: "Add API key" }));

        expect(onEdit).toHaveBeenCalledWith("github");
      }
    );

    it.each<[CustomConnectorStatus]>([
      [{ kind: "couldnt-start", reason: "x" }],
      [{ kind: "unreachable", reason: "x" }],
    ])("tries starting it again from Try again when the status is %j", (status) => {
      const { row, onTryAgain, onEdit } = renderRow(status);

      fireEvent.click(row.getByRole("button", { name: "Try again" }));

      expect(onTryAgain).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("offers Edit, Turn off on this device and Remove in its more-actions menu", async () => {
      const { onEdit, onSetTurnedOff, onRemove } = renderRow({ kind: "connected", toolCount: 2 });

      openMenu();
      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Edit",
        "Turn off on this device",
        "Remove",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Turn off on this device" }));
      expect(onSetTurnedOff).toHaveBeenCalledWith("github", true);
      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
      await waitFor(() => expect(onEdit).toHaveBeenCalledWith("github"));
      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
      await waitFor(() => expect(onRemove).toHaveBeenCalledWith("github"));
    });

    it("offers Turn on on this device for a connector turned off here", async () => {
      const { onSetTurnedOff } = renderRow({ kind: "off" });

      openMenu();
      fireEvent.click(await screen.findByRole("menuitem", { name: "Turn on on this device" }));

      expect(onSetTurnedOff).toHaveBeenCalledWith("github", false);
    });
  });

  describe("customStatusText()", () => {
    it("gives each status its tone and line, with the reason after the status", () => {
      expect(customStatusText({ kind: "connected", toolCount: 1 })).toEqual(["ok", "1 tool"]);
      expect(customStatusText({ kind: "couldnt-start", reason: "boom" })).toEqual([
        "attention",
        "Couldn't start · boom",
      ]);
      expect(customStatusText({ kind: "starting" })).toEqual(["idle", "Starting…"]);
    });
  });
});
