import type { PowerControl } from "@/keepAwake/electronPowerControl";
import {
  DEFAULT_KEEP_AWAKE_MODE,
  isKeepAwakeMode,
  KeepAwakeService,
  type KeepAwakeMode,
} from "@/keepAwake/KeepAwakeService";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/608";

interface Rig {
  service: KeepAwakeService;
  held: () => number[];
  started: number;
  stopped: number[];
  saved: KeepAwakeMode[];
  setTurn: (running: boolean) => void;
  setPaired: (paired: boolean) => void;
  setBattery: (onBattery: boolean) => void;
  closeWindow: () => void;
  power: { failStart: boolean; failStop: boolean };
  subscriptions: () => number;
}

interface RigOptions {
  mode?: KeepAwakeMode;
  paired?: boolean;
  battery?: boolean;
  failPowerSubscribe?: boolean;
  failTurnUnsubscribe?: boolean;
  probe?: { subscriptions?: () => number };
}

function makeRig(options: RigOptions = {}): Rig {
  const turnListeners = new Set<() => void>();
  const pairedListeners = new Set<() => void>();
  const powerListeners = new Set<() => void>();
  const windowListeners = new Set<() => void>();
  const state = {
    turn: false,
    paired: options.paired ?? false,
    battery: options.battery ?? false,
    mode: options.mode ?? DEFAULT_KEEP_AWAKE_MODE,
  };
  const failures = { failStart: false, failStop: false };
  const active = new Set<number>();
  const rig = { started: 0, stopped: [] as number[], saved: [] as KeepAwakeMode[] };
  const power: PowerControl = {
    startBlocker: () => {
      if (failures.failStart) throw new Error("start failed");
      const id = rig.started++;
      active.add(id);
      return id;
    },
    stopBlocker: (id) => {
      rig.stopped.push(id);
      active.delete(id);
      if (failures.failStop) throw new Error("stop failed");
    },
    isOnBattery: () => state.battery,
    onPowerSourceChange: (listener) => {
      if (options.failPowerSubscribe) throw new Error("subscribe failed");
      powerListeners.add(listener);
      return () => powerListeners.delete(listener);
    },
  };
  if (options.probe) {
    options.probe.subscriptions = () =>
      turnListeners.size + pairedListeners.size + powerListeners.size + windowListeners.size;
  }
  const service = new KeepAwakeService({
    power,
    isTurnRunning: () => state.turn,
    subscribeTurns: (listener) => {
      turnListeners.add(listener);
      return () => {
        if (options.failTurnUnsubscribe) throw new Error("unsubscribe failed");
        turnListeners.delete(listener);
      };
    },
    subscribeWindowClose: (listener) => {
      windowListeners.add(listener);
      return () => windowListeners.delete(listener);
    },
    hasPairedPhone: () => state.paired,
    subscribePairedPhones: (listener) => {
      pairedListeners.add(listener);
      return () => pairedListeners.delete(listener);
    },
    modeSlot: { load: () => state.mode, save: (mode) => rig.saved.push(mode) },
  });
  return {
    service,
    held: () => [...active],
    get started() {
      return rig.started;
    },
    stopped: rig.stopped,
    saved: rig.saved,
    setTurn: (running) => {
      state.turn = running;
      turnListeners.forEach((listener) => listener());
    },
    setPaired: (paired) => {
      state.paired = paired;
      pairedListeners.forEach((listener) => listener());
    },
    closeWindow: () => windowListeners.forEach((listener) => listener()),
    setBattery: (onBattery) => {
      state.battery = onBattery;
      powerListeners.forEach((listener) => listener());
    },
    power: failures,
    subscriptions: () =>
      turnListeners.size + pairedListeners.size + powerListeners.size + windowListeners.size,
  };
}

describe("keepAwake/KeepAwakeService", () => {
  describe("isKeepAwakeMode()", () => {
    it("accepts the three modes and rejects anything else", () => {
      expect(["never", "plugged", "always"].every(isKeepAwakeMode)).toBe(true);
      expect(isKeepAwakeMode("sometimes")).toBe(false);
      expect(isKeepAwakeMode(null)).toBe(false);
    });
  });

  describe("KeepAwakeService", () => {
    describe("agent turns", () => {
      it("holds nothing while idle", () => {
        const rig = makeRig();

        expect(rig.held()).toEqual([]);
        expect(rig.started).toBe(0);
      });

      it("acquires one blocker when a turn starts and releases it when the turn ends, with no phone paired", () => {
        const rig = makeRig({ paired: false });

        rig.setTurn(true);
        expect(rig.held()).toHaveLength(1);
        rig.setTurn(false);

        expect(rig.held()).toEqual([]);
        expect(rig.stopped).toEqual([0]);
      });

      it("keeps a single blocker across repeated turn notifications", () => {
        const rig = makeRig();

        rig.setTurn(true);
        rig.setTurn(true);
        rig.setTurn(true);

        expect(rig.started).toBe(1);
      });

      it("holds a blocker for a running turn even when the mode is never", () => {
        const rig = makeRig({ mode: "never", paired: true });

        rig.setTurn(true);

        expect(rig.held()).toHaveLength(1);
      });

      it("holds a blocker for a running turn while on battery", () => {
        const rig = makeRig({ battery: true });

        rig.setTurn(true);

        expect(rig.held()).toHaveLength(1);
      });

      it("keeps the blocker for a running turn after the last phone is unpaired", () => {
        const rig = makeRig({ mode: "always", paired: true });
        rig.setTurn(true);

        rig.setPaired(false);

        expect(rig.held()).toHaveLength(1);
      });
    });

    describe("Remote keep-awake with a paired phone", () => {
      it("holds a blocker at construction when a phone is paired and the default mode applies on AC power", () => {
        const rig = makeRig({ paired: true });

        expect(rig.held()).toHaveLength(1);
      });

      it("acquires a blocker when the first phone is paired and releases it when the last is unpaired", () => {
        const rig = makeRig({ mode: "always" });
        expect(rig.held()).toEqual([]);

        rig.setPaired(true);
        expect(rig.held()).toHaveLength(1);
        rig.setPaired(false);

        expect(rig.held()).toEqual([]);
      });

      it("never holds a blocker in never mode", () => {
        const rig = makeRig({ mode: "never", paired: true });

        expect(rig.held()).toEqual([]);
      });

      it("holds a blocker in always mode even on battery", () => {
        const rig = makeRig({ mode: "always", paired: true, battery: true });

        expect(rig.held()).toHaveLength(1);
      });

      it("holds a blocker in plugged mode on AC power and releases it when the computer switches to battery", () => {
        const rig = makeRig({ mode: "plugged", paired: true, battery: false });
        expect(rig.held()).toHaveLength(1);

        rig.setBattery(true);
        expect(rig.held()).toEqual([]);
        rig.setBattery(false);

        expect(rig.held()).toHaveLength(1);
      });

      it("holds nothing in plugged mode when the computer starts on battery", () => {
        const rig = makeRig({ mode: "plugged", paired: true, battery: true });

        expect(rig.held()).toEqual([]);
      });

      it("ignores power source changes when no phone is paired", () => {
        const rig = makeRig({ mode: "always", paired: false });

        rig.setBattery(true);
        rig.setBattery(false);

        expect(rig.started).toBe(0);
      });
    });

    describe("getMode() and setMode()", () => {
      it("loads the stored mode and exposes it through getMode", () => {
        expect(makeRig({ mode: "always" }).service.getMode()).toBe("always");
      });

      it("saves the new mode, notifies subscribers, and applies it at once", () => {
        const rig = makeRig({ mode: "never", paired: true });
        const listener = jest.fn();
        rig.service.subscribe(listener);

        rig.service.setMode("always");

        expect(rig.service.getMode()).toBe("always");
        expect(rig.saved).toEqual(["always"]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(rig.held()).toHaveLength(1);
      });

      it("releases the blocker immediately when the mode changes to never", () => {
        const rig = makeRig({ mode: "always", paired: true });

        rig.service.setMode("never");

        expect(rig.held()).toEqual([]);
      });

      it("keeps the blocker for a running turn when the mode changes to never", () => {
        const rig = makeRig({ mode: "always", paired: true });
        rig.setTurn(true);

        rig.service.setMode("never");

        expect(rig.held()).toHaveLength(1);
      });

      it("does nothing when the mode is unchanged", () => {
        const rig = makeRig({ mode: "always" });
        const listener = jest.fn();
        rig.service.subscribe(listener);

        rig.service.setMode("always");

        expect(rig.saved).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
      });

      it("stops notifying an unsubscribed listener", () => {
        const rig = makeRig();
        const listener = jest.fn();
        rig.service.subscribe(listener)();

        rig.service.setMode("always");

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("dispose()", () => {
      it(`releases a held blocker and stops listening so unloading the plugin restores normal sleep (${ISSUE})`, () => {
        const rig = makeRig({ mode: "always", paired: true });
        rig.setTurn(true);
        expect(rig.subscriptions()).toBe(4);

        rig.service.dispose();

        expect(rig.held()).toEqual([]);
        expect(rig.subscriptions()).toBe(0);
      });

      it(`releases the blocker when the window closes without the plugin being unloaded, because the blocker lives in Electron's main process and would outlive the window (${ISSUE})`, () => {
        const rig = makeRig({ mode: "always", paired: true });
        expect(rig.held()).toHaveLength(1);

        rig.closeWindow();

        expect(rig.held()).toEqual([]);
        expect(rig.subscriptions()).toBe(0);
      });

      it(`does not re-acquire when a source fires after disposal (${ISSUE})`, () => {
        const rig = makeRig({ mode: "always" });
        rig.service.dispose();

        rig.setPaired(true);
        rig.service.setMode("plugged");

        expect(rig.started).toBe(0);
      });
    });

    describe("failing subscriptions", () => {
      it(`releases the blocker and disposes every other listener when one unsubscribe throws (${ISSUE})`, () => {
        const rig = makeRig({ mode: "always", paired: true, failTurnUnsubscribe: true });
        expect(rig.held()).toHaveLength(1);

        expect(() => rig.service.dispose()).not.toThrow();

        expect(rig.held()).toEqual([]);
        expect(rig.subscriptions()).toBe(1);
      });

      it(`removes the listeners it already added when a later subscription throws during construction (${ISSUE})`, () => {
        const probe: NonNullable<RigOptions["probe"]> = {};

        expect(() =>
          makeRig({ mode: "always", paired: true, failPowerSubscribe: true, probe })
        ).toThrow("subscribe failed");

        expect(probe.subscriptions?.()).toBe(0);
      });
    });

    describe("failing power APIs", () => {
      it(`survives a blocker that cannot start and retries on the next change (${ISSUE})`, () => {
        const rig = makeRig({ mode: "always" });
        rig.power.failStart = true;

        expect(() => rig.setPaired(true)).not.toThrow();
        expect(rig.held()).toEqual([]);
        rig.power.failStart = false;
        rig.setTurn(true);

        expect(rig.held()).toHaveLength(1);
      });

      it(`keeps the handle of a blocker that cannot be stopped, so no second blocker is started and a later release retries it (${ISSUE})`, () => {
        const rig = makeRig({ mode: "always", paired: true });
        rig.power.failStop = true;

        expect(() => rig.setPaired(false)).not.toThrow();
        rig.setPaired(true);
        expect(rig.started).toBe(1);

        rig.power.failStop = false;
        rig.setPaired(false);

        expect(rig.held()).toEqual([]);
        expect(rig.started).toBe(1);
      });
    });
  });
});
