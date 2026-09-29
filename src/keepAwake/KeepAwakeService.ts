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
  private readonly cleanups: Array<() => void>;

  constructor(private readonly deps: KeepAwakeServiceDeps) {
    this.mode = deps.modeSlot.load();
    this.cleanups = [
      deps.subscribeTurns(() => this.reconcile()),
      deps.subscribePairedPhones(() => this.reconcile()),
      deps.power.onPowerSourceChange(() => this.reconcile()),
    ];
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
    for (const cleanup of this.cleanups.splice(0)) cleanup();
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
    const id = this.blockerId;
    this.blockerId = null;
    try {
      this.deps.power.stopBlocker(id);
    } catch (error) {
      logWarn("Keep-awake could not release the power blocker", error);
    }
  }
}
