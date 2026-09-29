import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { KeepAwakeMode } from "@/keepAwake";
import type { RemoteHostViewState } from "@/remote/hostState";
import { RemoteHostPanel } from "@/remote/ui/RemoteHostPanel";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

const LINK =
  "obsidian://copilot-pair?host=100.64.0.7&port=52341&vault=Work+notes&vaultId=3f9a1c2e&secret=k3Jd8sLq0Zt5vXw9bN2mRa7Y";

const READY: RemoteHostViewState = {
  plus: true,
  tailscaleAddress: "100.64.0.7",
  listening: false,
  pairing: null,
  devices: [],
  error: null,
};

function renderPanel(
  state: Partial<RemoteHostViewState> = {},
  keepAwake: { keepAwakeMode?: KeepAwakeMode } = {}
) {
  const props = {
    ...keepAwake,
    onKeepAwakeModeChange: jest.fn(),
    state: { ...READY, ...state },
    onStartPairing: jest.fn(),
    onCancelPairing: jest.fn(),
    onCopyLink: jest.fn(),
    onRevoke: jest.fn(),
    onRecheck: jest.fn(),
    onUpgrade: jest.fn(),
  };
  render(<RemoteHostPanel {...props} />);
  return props;
}

describe("RemoteHostPanel", () => {
  describe("RemoteHostPanel()", () => {
    describe("without Copilot Plus", () => {
      it("explains that Remote needs Copilot Plus and offers the upgrade, with no pairing controls", () => {
        const props = renderPanel({ plus: false });

        expect(screen.getByText(/needs Copilot Plus/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Pair a phone" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "See Copilot Plus" }));
        expect(props.onUpgrade).toHaveBeenCalledTimes(1);
      });

      it(`still lists paired phones with Revoke so a lost phone can be cut off after Plus lapsed (${ISSUE})`, () => {
        const props = renderPanel({
          plus: false,
          devices: [{ id: "a", name: "iPhone", createdAt: 1, lastSeenAt: null, connected: false }],
        });

        fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

        expect(screen.getByText("iPhone")).toBeTruthy();
        expect(props.onRevoke).toHaveBeenCalledWith("a");
      });

      it(`shows no paired-phone list when Plus lapsed and no phone is paired (${ISSUE})`, () => {
        renderPanel({ plus: false, devices: [] });

        expect(screen.queryByText("No phones are paired with this vault.")).toBeNull();
      });

      it("says nothing listens on the network", () => {
        renderPanel({ plus: false });

        expect(screen.getByText(/never listens on your network/)).toBeTruthy();
      });
    });

    describe("without Tailscale", () => {
      it("says Tailscale was not detected, hides the pairing button, and offers a recheck", () => {
        const props = renderPanel({ tailscaleAddress: null });

        expect(screen.getByText("Tailscale not detected")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Pair a phone" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Check again" }));
        expect(props.onRecheck).toHaveBeenCalledTimes(1);
      });
    });

    describe("ready to pair", () => {
      it("offers to pair a phone and starts pairing on click", () => {
        const props = renderPanel();

        fireEvent.click(screen.getByRole("button", { name: "Pair a phone" }));

        expect(props.onStartPairing).toHaveBeenCalledTimes(1);
      });

      it("says no phones are paired when the list is empty", () => {
        renderPanel();

        expect(screen.getByText("No phones are paired with this vault.")).toBeTruthy();
      });
    });

    describe("pairing in progress", () => {
      const pairing = { link: LINK, expiresAt: 1 };

      it("shows the QR code and tells the user to open the same vault on the phone first", () => {
        renderPanel({ listening: true, pairing });

        expect(screen.getByRole("img", { name: "Pairing QR code" })).toBeTruthy();
        expect(screen.getByText(/Open this same vault on your phone first/)).toBeTruthy();
        expect(screen.getByText(/drops the link if a different vault is open/)).toBeTruthy();
      });

      it("states that the code works once and expires", () => {
        renderPanel({ listening: true, pairing });

        expect(screen.getByText(/works once and expires in 5 minutes/)).toBeTruthy();
      });

      it("copies the pairing link for the paste fallback", () => {
        const props = renderPanel({ listening: true, pairing });

        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

        expect(props.onCopyLink).toHaveBeenCalledWith(LINK);
      });

      it("cancels the pairing", () => {
        const props = renderPanel({ listening: true, pairing });

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(props.onCancelPairing).toHaveBeenCalledTimes(1);
      });

      it("replaces the pairing button while a code is showing", () => {
        renderPanel({ listening: true, pairing });

        expect(screen.queryByRole("button", { name: "Pair a phone" })).toBeNull();
      });
    });

    describe("paired phones", () => {
      const devices = [
        {
          id: "a",
          name: "Zero's iPhone",
          createdAt: 1_700_000_000_000,
          lastSeenAt: 1_700_000_500_000,
          connected: false,
        },
        { id: "b", name: "iPad", createdAt: 1_700_000_000_000, lastSeenAt: null, connected: false },
        {
          id: "c",
          name: "Work phone",
          createdAt: 1_700_000_000_000,
          lastSeenAt: 1_700_000_500_000,
          connected: true,
        },
      ];

      it("lists each phone with when it last connected", () => {
        renderPanel({ devices });

        expect(screen.getByText("Zero's iPhone")).toBeTruthy();
        expect(screen.getByText(/Last seen/)).toBeTruthy();
      });

      it("says a phone that never connected has never connected", () => {
        renderPanel({ devices });

        expect(screen.getByText(/Never connected/)).toBeTruthy();
      });

      it("marks a phone that is connected right now", () => {
        renderPanel({ devices });

        expect(screen.getByText(/Connected now/)).toBeTruthy();
      });

      it("revokes the phone whose button was clicked", () => {
        const props = renderPanel({ devices });

        fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[1]);

        expect(props.onRevoke).toHaveBeenCalledWith("b");
      });
    });

    describe("keep-awake setting", () => {
      const device = { id: "a", name: "iPhone", createdAt: 1, lastSeenAt: null, connected: false };
      const KEEP_AWAKE_TITLE = "Keep this computer awake for remote access";

      it("offers Never, While plugged in and Always with the current choice selected once a phone is paired", () => {
        renderPanel({ devices: [device] }, { keepAwakeMode: "plugged" });

        const select = screen.getByRole<HTMLSelectElement>("combobox");
        expect(screen.getByText(KEEP_AWAKE_TITLE)).toBeTruthy();
        expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
          "Never",
          "While plugged in",
          "Always",
        ]);
        expect(select.value).toBe("plugged");
      });

      it("reports the chosen mode", () => {
        const props = renderPanel({ devices: [device] }, { keepAwakeMode: "plugged" });

        fireEvent.change(screen.getByRole<HTMLSelectElement>("combobox"), {
          target: { value: "never" },
        });

        expect(props.onKeepAwakeModeChange).toHaveBeenCalledWith("never");
      });

      it("is hidden while no phone is paired", () => {
        renderPanel({ devices: [] }, { keepAwakeMode: "plugged" });

        expect(screen.queryByText(KEEP_AWAKE_TITLE)).toBeNull();
      });

      it("is hidden when the computer's power APIs are unavailable", () => {
        renderPanel({ devices: [device] });

        expect(screen.queryByText(KEEP_AWAKE_TITLE)).toBeNull();
      });

      it("is hidden without Copilot Plus", () => {
        renderPanel({ plus: false, devices: [device] }, { keepAwakeMode: "plugged" });

        expect(screen.queryByText(KEEP_AWAKE_TITLE)).toBeNull();
      });
    });

    describe("errors", () => {
      it("shows the listener error where the user is looking", () => {
        renderPanel({ error: "Copilot could not start the Remote listener." });

        expect(screen.getByRole("alert").textContent).toContain(
          "could not start the Remote listener"
        );
      });

      it("shows no alert when there is no error", () => {
        renderPanel();

        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });
});
