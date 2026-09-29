import { logInfo, logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

/** The slice of Electron's power APIs the keep-awake service needs. https://github.com/Brevilabs/obsidian-copilot-private/issues/608 */
export interface PowerControl {
  startBlocker(): number;
  stopBlocker(id: number): void;
  isOnBattery(): boolean;
  onPowerSourceChange(listener: () => void): () => void;
}

type PowerSourceEvent = "on-ac" | "on-battery";

interface ElectronPowerRemote {
  powerSaveBlocker?: {
    start?: (type: "prevent-app-suspension") => number;
    stop?: (id: number) => void;
  };
  powerMonitor?: {
    isOnBatteryPower?: () => boolean;
    on?: (event: PowerSourceEvent, listener: () => void) => unknown;
    removeListener?: (event: PowerSourceEvent, listener: () => void) => unknown;
  };
}

const POWER_SOURCE_EVENTS: readonly PowerSourceEvent[] = ["on-ac", "on-battery"];

/**
 * Reaches Electron's `powerSaveBlocker` and `powerMonitor` through `electron.remote`. Returns
 * null when either is unreachable, so callers keep working without keep-awake.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/608
 */
export function createElectronPowerControl(): PowerControl | null {
  try {
    const remote = requireNodeModule<{ remote?: ElectronPowerRemote }>("electron").remote;
    const blocker = remote?.powerSaveBlocker;
    const monitor = remote?.powerMonitor;
    if (
      !blocker?.start ||
      !blocker.stop ||
      !monitor?.isOnBatteryPower ||
      !monitor.on ||
      !monitor.removeListener
    ) {
      logInfo("Keep-awake is unavailable: Electron power APIs are not reachable.");
      return null;
    }
    return {
      startBlocker: () => blocker.start!("prevent-app-suspension"),
      stopBlocker: (id) => blocker.stop!(id),
      isOnBattery: () => monitor.isOnBatteryPower!(),
      onPowerSourceChange: (listener) => {
        for (const event of POWER_SOURCE_EVENTS) monitor.on!(event, listener);
        return () => {
          for (const event of POWER_SOURCE_EVENTS) monitor.removeListener!(event, listener);
        };
      },
    };
  } catch (error) {
    logWarn("Keep-awake is unavailable: Electron could not be loaded.", error);
    return null;
  }
}
