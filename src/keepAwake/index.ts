import type { App } from "obsidian";
import {
  DEFAULT_KEEP_AWAKE_MODE,
  isKeepAwakeMode,
  KeepAwakeService,
  type KeepAwakeServiceDeps,
} from "@/keepAwake/KeepAwakeService";
import { createElectronPowerControl } from "@/keepAwake/electronPowerControl";
import type { RemoteHostViewState } from "@/remote/hostState";

export { KeepAwakeService } from "@/keepAwake/KeepAwakeService";
export type { KeepAwakeMode } from "@/keepAwake/KeepAwakeService";

const MODE_STORAGE_KEY = "copilot-keep-awake-mode:v1";

/**
 * Stores the Remote keep-awake choice in this vault window's device-local storage, so it never
 * syncs to another desktop that has its own power source and pairings.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/608
 */
export function createModeSlot(app: App): KeepAwakeServiceDeps["modeSlot"] {
  return {
    load: () => {
      const stored = app.loadLocalStorage(MODE_STORAGE_KEY);
      return isKeepAwakeMode(stored) ? stored : DEFAULT_KEEP_AWAKE_MODE;
    },
    save: (mode) => app.saveLocalStorage(MODE_STORAGE_KEY, mode),
  };
}

export interface TurnSource {
  hasRunningTurn(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface PairingSource {
  getState(): Pick<RemoteHostViewState, "plus" | "devices">;
  subscribe(listener: () => void): () => void;
}

/**
 * Adapts the agent session manager and the Remote host into the service's inputs. Without a
 * Remote host no phone can be paired, so only agent turns keep the computer awake.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/608
 */
export function createKeepAwakeSources(
  turns: TurnSource,
  pairing: PairingSource | undefined
): Omit<KeepAwakeServiceDeps, "power" | "modeSlot" | "subscribeWindowClose"> {
  return {
    isTurnRunning: () => turns.hasRunningTurn(),
    subscribeTurns: (listener) => turns.subscribe(listener),
    hasPairedPhone: () => {
      const state = pairing?.getState();
      return !!state && state.plus && state.devices.length > 0;
    },
    subscribePairedPhones: (listener) => pairing?.subscribe(listener) ?? (() => {}),
  };
}

/** Returns null when Electron's power APIs are unreachable. https://github.com/Brevilabs/obsidian-copilot-private/issues/608 */
export function createKeepAwake(
  app: App,
  turns: TurnSource,
  pairing: PairingSource | undefined
): KeepAwakeService | null {
  const power = createElectronPowerControl();
  if (!power) return null;
  return new KeepAwakeService({
    power,
    modeSlot: createModeSlot(app),
    subscribeWindowClose: (listener) => {
      window.addEventListener("pagehide", listener);
      return () => window.removeEventListener("pagehide", listener);
    },
    ...createKeepAwakeSources(turns, pairing),
  });
}
