import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice, Platform } from "obsidian";
import React from "react";
import { PluginProvider } from "@/contexts/PluginContext";
import type CopilotPlugin from "@/main";
import { PairedDesktopStore } from "@/remote/client/PairedDesktopStore";
import type { RemoteClient } from "@/remote/client";
import type { RemoteHostViewState } from "@/remote/hostState";
import type { RemoteHostService } from "@/remote/host";
import { RemoteSettings } from "@/settings/v2/components/RemoteSettings";

jest.mock("@/plusUtils", () => ({ navigateToPlusPage: jest.fn() }));
jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  Notice: jest.fn(),
}));

const LINK =
  "obsidian://copilot-pair?host=100.64.0.7&port=52341&vault=Work&vaultId=3f9a1c2e&secret=k3Jd8sLq0Zt5vXw9bN2mRa7Y";

function makeHost(initial: Partial<RemoteHostViewState> = {}) {
  let state: RemoteHostViewState = {
    plus: true,
    tailscaleAddress: "100.64.0.7",
    listening: false,
    pairing: null,
    devices: [],
    error: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const host = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recheck: jest.fn().mockResolvedValue(undefined),
    startPairing: jest.fn().mockResolvedValue(undefined),
    cancelPairing: jest.fn(),
    revokeDevice: jest.fn(),
  };
  return {
    host: host as unknown as RemoteHostService,
    mocks: host,
    set(next: Partial<RemoteHostViewState>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
  };
}

function renderWith(plugin: Partial<CopilotPlugin>) {
  return render(
    <PluginProvider plugin={plugin as CopilotPlugin}>
      <RemoteSettings />
    </PluginProvider>
  );
}

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

describe("RemoteSettings", () => {
  const original = { ...Platform };

  afterEach(() => {
    Object.assign(Platform, original);
    jest.clearAllMocks();
  });

  describe("RemoteSettings()", () => {
    describe("on desktop", () => {
      it("rechecks Tailscale when the section opens so a network started since is noticed", () => {
        const { host, mocks } = makeHost();

        renderWith({ remoteHost: host });

        expect(mocks.recheck).toHaveBeenCalledTimes(1);
      });

      it("starts pairing from the button and shows the QR code once the service publishes a pairing", async () => {
        const rig = makeHost();
        renderWith({ remoteHost: rig.host });

        fireEvent.click(screen.getByRole("button", { name: "Pair a phone" }));
        act(() => rig.set({ listening: true, pairing: { link: LINK, expiresAt: 1 } }));

        expect(rig.mocks.startPairing).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("img", { name: "Pairing QR code" })).toBeTruthy();
      });

      it("copies the pairing link to the clipboard and confirms with a notice", async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const rig = makeHost({ listening: true, pairing: { link: LINK, expiresAt: 1 } });
        renderWith({ remoteHost: rig.host });

        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

        expect(writeText).toHaveBeenCalledWith(LINK);
        await waitFor(() => expect(Notice).toHaveBeenCalledWith("Pairing link copied."));
      });

      it("tells the user when the link could not be copied", async () => {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
          configurable: true,
        });
        const rig = makeHost({ listening: true, pairing: { link: LINK, expiresAt: 1 } });
        renderWith({ remoteHost: rig.host });

        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

        await waitFor(() =>
          expect(Notice).toHaveBeenCalledWith("Copilot could not copy the pairing link.")
        );
      });

      it("revokes a device through the service", () => {
        const rig = makeHost({
          devices: [{ id: "a", name: "iPhone", createdAt: 1, lastSeenAt: null, connected: false }],
        });
        renderWith({ remoteHost: rig.host });

        fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

        expect(rig.mocks.revokeDevice).toHaveBeenCalledWith("a");
      });

      it("explains the Plus requirement when the account has no Plus", () => {
        renderWith({ remoteHost: makeHost({ plus: false }).host });

        expect(screen.getByText(/needs Copilot Plus/)).toBeTruthy();
      });

      it("says Remote could not start when the plugin has no host service", () => {
        renderWith({});

        expect(screen.getByText(/Remote access could not start/)).toBeTruthy();
      });
    });

    describe("on a phone", () => {
      function makeClient() {
        let raw: string | null = null;
        const store = new PairedDesktopStore({ read: () => raw, write: (v) => (raw = v) });
        const client = {
          store,
          pairFromLink: jest.fn().mockResolvedValue({ ok: false, reason: "expired-or-used" }),
          connect: jest.fn(),
        };
        return { client: client as unknown as RemoteClient, mocks: client, store };
      }

      beforeEach(() => {
        Object.assign(Platform, { isMobile: true });
      });

      it("shows the pairing screen for a phone rather than the desktop's", () => {
        renderWith({ remoteClient: makeClient().client });

        expect(screen.getByLabelText("Pairing link")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Pair a phone" })).toBeNull();
      });

      it("pairs from a pasted link and reports the failure in words", async () => {
        const { client, mocks } = makeClient();
        renderWith({ remoteClient: client });

        fireEvent.change(screen.getByLabelText("Pairing link"), { target: { value: LINK } });
        fireEvent.click(screen.getByRole("button", { name: "Pair" }));

        expect(mocks.pairFromLink).toHaveBeenCalledWith(LINK);
        expect((await screen.findByRole("status")).textContent).toContain(
          "expired or was already used"
        );
      });

      it("lists the desktops paired for this vault and removes one on request", () => {
        const { client, store } = makeClient();
        store.add({
          id: "d1",
          host: "100.64.0.7",
          port: 52341,
          token: "t",
          desktopName: "Studio Mac",
          vaultName: "Work",
          pairedAt: 1,
        });
        renderWith({ remoteClient: client });

        expect(screen.getByText("Studio Mac")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Remove" }));

        expect(store.list()).toEqual([]);
        expect(screen.getByText("No desktops are paired for this vault.")).toBeTruthy();
      });

      it("tests a connection and reports success, then closes the channel", async () => {
        const { client, mocks, store } = makeClient();
        store.add({
          id: "d1",
          host: "100.64.0.7",
          port: 52341,
          token: "t",
          desktopName: "Studio Mac",
          vaultName: "",
          pairedAt: 1,
        });
        const close = jest.fn();
        mocks.connect.mockResolvedValue({ ok: true, channel: { close }, deviceId: "x" });
        renderWith({ remoteClient: client });

        fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

        expect(await screen.findByText("Connected to Studio Mac.")).toBeTruthy();
        expect(close).toHaveBeenCalledTimes(1);
      });

      it(`tells the user to pair again when the desktop rejects the token (${ISSUE})`, async () => {
        const { client, mocks, store } = makeClient();
        store.add({
          id: "d1",
          host: "100.64.0.7",
          port: 52341,
          token: "t",
          desktopName: "Studio Mac",
          vaultName: "",
          pairedAt: 1,
        });
        mocks.connect.mockResolvedValue({ ok: false, reason: "token-rejected" });
        renderWith({ remoteClient: client });

        fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

        expect(await screen.findByText(/no longer accepts this phone/)).toBeTruthy();
      });

      it("explains an unreachable desktop with the Tailscale hint", async () => {
        const { client, mocks, store } = makeClient();
        store.add({
          id: "d1",
          host: "100.64.0.7",
          port: 52341,
          token: "t",
          desktopName: "Studio Mac",
          vaultName: "",
          pairedAt: 1,
        });
        mocks.connect.mockResolvedValue({ ok: false, reason: "unreachable" });
        renderWith({ remoteClient: client });

        fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

        expect(await screen.findByText(/Check that Tailscale is on/)).toBeTruthy();
      });

      it("says Remote is unavailable when the plugin has no client", () => {
        renderWith({});

        expect(screen.getByText(/unavailable in this session/)).toBeTruthy();
      });
    });
  });
});
