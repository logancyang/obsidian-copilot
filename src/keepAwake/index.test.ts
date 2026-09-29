import type { App } from "obsidian";
import { createKeepAwake, createKeepAwakeSources, createModeSlot } from "@/keepAwake";
import { createElectronPowerControl } from "@/keepAwake/electronPowerControl";

jest.mock("@/keepAwake/electronPowerControl", () => ({ createElectronPowerControl: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/608";

function makeApp(initial: string | null = null) {
  const store = new Map<string, string>();
  if (initial !== null) store.set("copilot-keep-awake-mode:v1", initial);
  const app = {
    loadLocalStorage: jest.fn((key: string) => store.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, value: string) => void store.set(key, value)),
  };
  return { app: app as unknown as App, store };
}

function makeListenable<T extends object>(base: T) {
  const listeners = new Set<() => void>();
  return {
    ...base,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => listeners.forEach((listener) => listener()),
    size: () => listeners.size,
  };
}

describe("keepAwake", () => {
  describe("createModeSlot()", () => {
    it("defaults to plugged when nothing is stored", () => {
      expect(createModeSlot(makeApp().app).load()).toBe("plugged");
    });

    it("returns a stored valid mode", () => {
      expect(createModeSlot(makeApp("always").app).load()).toBe("always");
    });

    it("falls back to plugged when the stored value is not a mode", () => {
      expect(createModeSlot(makeApp("sometimes").app).load()).toBe("plugged");
    });

    it("saves the mode under a device-local key", () => {
      const { app, store } = makeApp();

      createModeSlot(app).save("never");

      expect(store.get("copilot-keep-awake-mode:v1")).toBe("never");
    });
  });

  describe("createKeepAwakeSources()", () => {
    it("reports a running turn and forwards turn subscriptions", () => {
      let running = false;
      const turns = makeListenable({ hasRunningTurn: () => running });
      const sources = createKeepAwakeSources(turns, undefined);
      const listener = jest.fn();

      const unsubscribe = sources.subscribeTurns(listener);
      running = true;
      turns.emit();

      expect(sources.isTurnRunning()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      expect(turns.size()).toBe(0);
    });

    it("reports a paired phone only when Plus is active and a device exists", () => {
      const device = { id: "d", name: "Phone", createdAt: 1, lastSeenAt: null, connected: false };
      let state = { plus: true, devices: [device] as readonly (typeof device)[] };
      const pairing = makeListenable({ getState: () => state });
      const sources = createKeepAwakeSources(
        makeListenable({ hasRunningTurn: () => false }),
        pairing
      );

      expect(sources.hasPairedPhone()).toBe(true);
      state = { plus: false, devices: [device] };
      expect(sources.hasPairedPhone()).toBe(false);
      state = { plus: true, devices: [] };
      expect(sources.hasPairedPhone()).toBe(false);
    });

    it("forwards pairing subscriptions", () => {
      const pairing = makeListenable({ getState: () => ({ plus: true, devices: [] }) });
      const sources = createKeepAwakeSources(
        makeListenable({ hasRunningTurn: () => false }),
        pairing
      );
      const listener = jest.fn();

      const unsubscribe = sources.subscribePairedPhones(listener);
      pairing.emit();
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();

      expect(pairing.size()).toBe(0);
    });

    it(`never reports a paired phone without a Remote host (${ISSUE})`, () => {
      const sources = createKeepAwakeSources(
        makeListenable({ hasRunningTurn: () => false }),
        undefined
      );
      const listener = jest.fn();

      expect(sources.hasPairedPhone()).toBe(false);
      expect(() => sources.subscribePairedPhones(listener)()).not.toThrow();
    });
  });

  describe("createKeepAwake()", () => {
    it(`returns null when Electron's power APIs are unreachable (${ISSUE})`, () => {
      (createElectronPowerControl as jest.Mock).mockReturnValue(null);

      expect(
        createKeepAwake(makeApp().app, makeListenable({ hasRunningTurn: () => false }), undefined)
      ).toBeNull();
    });

    it("returns a service that holds a blocker while a turn runs", () => {
      const start = jest.fn(() => 3);
      const stop = jest.fn();
      (createElectronPowerControl as jest.Mock).mockReturnValue({
        startBlocker: start,
        stopBlocker: stop,
        isOnBattery: () => false,
        onPowerSourceChange: () => () => {},
      });
      let running = false;
      const turns = makeListenable({ hasRunningTurn: () => running });

      const service = createKeepAwake(makeApp().app, turns, undefined)!;
      running = true;
      turns.emit();
      expect(start).toHaveBeenCalledTimes(1);
      running = false;
      turns.emit();

      expect(stop).toHaveBeenCalledWith(3);
      service.dispose();
    });
  });
});
