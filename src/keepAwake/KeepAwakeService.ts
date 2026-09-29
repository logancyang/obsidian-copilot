import { logWarn } from "@/logger";
import type { PowerControl } from "@/keepAwake/electronPowerControl";

export type KeepAwakeMode = "never" | "plugged" | "always";

export const DEFAULT_KEEP_AWAKE_MODE: KeepAwakeMode = "plugged";

export function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
  return value === "never" || value === "plugged" || value === "always";
}

export interface KeepAwakeServiceDeps {
  power: PowerControl;
  isTurnRunning: () => boolean;
  subscribeTurns: (listener: () => void) => () => void;
  hasPairedPhone: () => boolean;
  subscribePairedPhones: (listener: () => void) => () => void;
  modeSlot: { load: () => KeepAwakeMode; save: (mode: KeepAwakeMode) => void };
}

/**
 * Holds at most one Electron power-save blocker for this vault window while an agent turn runs,
 * or while a phone is paired and the user's Remote keep-awake choice allows it. It owns nothing
 * but the blocker and that choice; turn and pairing state come from the injected sources.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/608
 */
export class KeepAwakeService {
  private blockerId: number | null = null;
  private mode: KeepAwakeMode;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly deps: KeepAwakeServiceDeps) {
    this.mode = deps.modeSlot.load();
    // A failed subscription must not leave earlier listeners on an instance nobody can dispose:
    // one would later start a blocker that nothing releases.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/608
    try {
      this.cleanups.push(deps.subscribeTurns(() => this.reconcile()));
      this.cleanups.push(deps.subscribePairedPhones(() => this.reconcile()));
      this.cleanups.push(deps.power.onPowerSourceChange(() => this.reconcile()));
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.reconcile();
  }

  getMode = (): KeepAwakeMode => this.mode;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setMode(mode: KeepAwakeMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.deps.modeSlot.save(mode);
    this.reconcile();
    for (const listener of [...this.listeners]) listener();
  }

  /** Releases the blocker. Unloading the plugin must not leave the computer unable to sleep. https://github.com/Brevilabs/obsidian-copilot-private/issues/608 */
  dispose(): void {
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        logWarn("Keep-awake could not remove a listener", error);
      }
    }
    this.release();
    this.listeners.clear();
  }

  private shouldHold(): boolean {
    if (this.deps.isTurnRunning()) return true;
    if (!this.deps.hasPairedPhone()) return false;
    if (this.mode === "always") return true;
    return this.mode === "plugged" && !this.deps.power.isOnBattery();
  }

  private reconcile(): void {
    if (this.disposed) return;
    try {
      if (this.shouldHold()) {
        this.blockerId ??= this.deps.power.startBlocker();
      } else {
        this.release();
      }
    } catch (error) {
      logWarn("Keep-awake could not update the power blocker", error);
    }
  }

  private release(): void {
    if (this.blockerId === null) return;
    try {
      this.deps.power.stopBlocker(this.blockerId);
      this.blockerId = null;
    } catch (error) {
      // The handle is kept so the next reconcile retries it instead of starting a second blocker.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/608
      logWarn("Keep-awake could not release the power blocker", error);
    }
  }
}
