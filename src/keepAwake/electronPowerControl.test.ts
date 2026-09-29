import { createElectronPowerControl } from "@/keepAwake/electronPowerControl";
import { requireNodeModule } from "@/utils/desktopRuntime";

jest.mock("@/utils/desktopRuntime", () => ({ requireNodeModule: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/608";
const mockRequire = requireNodeModule as jest.Mock;

function makeRemote() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    powerSaveBlocker: { start: jest.fn(() => 7), stop: jest.fn() },
    powerMonitor: {
      isOnBatteryPower: jest.fn(() => true),
      on: jest.fn((event: string, listener: () => void) => {
        listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
      }),
      removeListener: jest.fn((event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener);
      }),
    },
  };
}

describe("keepAwake/electronPowerControl", () => {
  afterEach(() => jest.clearAllMocks());

  describe("createElectronPowerControl()", () => {
    it("starts an app-suspension blocker, stops it by id, and reads the battery state", () => {
      const remote = makeRemote();
      mockRequire.mockReturnValue({ remote });

      const power = createElectronPowerControl()!;

      expect(power.startBlocker()).toBe(7);
      expect(remote.powerSaveBlocker.start).toHaveBeenCalledWith("prevent-app-suspension");
      power.stopBlocker(7);
      expect(remote.powerSaveBlocker.stop).toHaveBeenCalledWith(7);
      expect(power.isOnBattery()).toBe(true);
    });

    it("notifies on both power-source events and removes both listeners on unsubscribe", () => {
      const remote = makeRemote();
      mockRequire.mockReturnValue({ remote });
      const power = createElectronPowerControl()!;
      const listener = jest.fn();

      const unsubscribe = power.onPowerSourceChange(listener);
      remote.listeners.get("on-battery")!.forEach((fn) => fn());
      remote.listeners.get("on-ac")!.forEach((fn) => fn());
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();

      expect(remote.listeners.get("on-battery")!.size).toBe(0);
      expect(remote.listeners.get("on-ac")!.size).toBe(0);
    });

    it(`returns null when electron.remote is missing (${ISSUE})`, () => {
      mockRequire.mockReturnValue({});

      expect(createElectronPowerControl()).toBeNull();
    });

    it(`returns null when powerMonitor lacks a required function (${ISSUE})`, () => {
      const remote = makeRemote();
      mockRequire.mockReturnValue({
        remote: {
          ...remote,
          powerMonitor: { isOnBatteryPower: remote.powerMonitor.isOnBatteryPower },
        },
      });

      expect(createElectronPowerControl()).toBeNull();
    });

    it(`returns null when Electron cannot be loaded, as on a non-desktop runtime (${ISSUE})`, () => {
      mockRequire.mockImplementation(() => {
        throw new Error("unavailable");
      });

      expect(createElectronPowerControl()).toBeNull();
    });
  });
});
