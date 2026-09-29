import { digestsEqual, sha256Hex } from "@/remote/host/digest";
import { requireNodeModule } from "@/utils/desktopRuntime";

export const PAIRING_TTL_MS = 5 * 60 * 1000;

export interface ActivePairing {
  secret: string;
  expiresAt: number;
}

export interface PairingWindowOptions {
  ttlMs?: number;
  now?: () => number;
  generateSecret?: () => string;
}

function generateRandomSecret(): string {
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  return crypto.randomBytes(24).toString("base64url");
}

export class PairingWindow {
  private active: ActivePairing | null = null;
  private expiryTimer: number | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly generateSecret: () => string;

  constructor(options: PairingWindowOptions = {}) {
    this.ttlMs = options.ttlMs ?? PAIRING_TTL_MS;
    this.now = options.now ?? Date.now;
    this.generateSecret = options.generateSecret ?? generateRandomSecret;
  }

  start(): ActivePairing {
    this.clear();
    const pairing = { secret: this.generateSecret(), expiresAt: this.now() + this.ttlMs };
    this.active = pairing;
    this.expiryTimer = window.setTimeout(() => {
      this.expiryTimer = undefined;
      this.active = null;
      this.notify();
    }, this.ttlMs);
    this.notify();
    return pairing;
  }

  cancel(): void {
    if (!this.active) return;
    this.clear();
    this.notify();
  }

  getActive(): ActivePairing | null {
    if (this.active && this.now() >= this.active.expiresAt) return null;
    return this.active;
  }

  consume(presented: string): boolean {
    const active = this.getActive();
    if (!active) return false;
    if (!digestsEqual(sha256Hex(presented), sha256Hex(active.secret))) return false;
    this.clear();
    this.notify();
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.clear();
    this.listeners.clear();
  }

  private clear(): void {
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.active = null;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
