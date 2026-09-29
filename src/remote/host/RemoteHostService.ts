import { logError, logInfo } from "@/logger";
import { buildPairingLink } from "@/remote/pairingLink";
import type { PairedDeviceView, RemoteHostViewState } from "@/remote/hostState";
import type { PairedDevice, PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import type { PairingWindow } from "@/remote/host/PairingWindow";
import { RemoteServer, type RemoteConnection } from "@/remote/host/RemoteServer";

export const RECHECK_INTERVAL_MS = 15_000;

export interface RemoteHostServiceDeps {
  store: PairedDeviceStore;
  pairing: PairingWindow;
  isPlus: () => boolean;
  subscribePlus: (listener: () => void) => () => void;
  findTailscaleAddress: () => string | null;
  vault: { name: string; id: string };
  desktopName: string;
  port: { load: () => number | null; save: (port: number) => void };
}

interface Listening {
  host: string;
  port: number;
}

const EMPTY_DEVICES: readonly PairedDeviceView[] = Object.freeze([]);
const NO_STORED_DEVICES: readonly PairedDevice[] = Object.freeze([]);

function isAddressInUse(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "EADDRINUSE";
}

export class RemoteHostService {
  private readonly server: RemoteServer;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];
  private listening: Listening | null = null;
  private tailscaleAddress: string | null = null;
  private error: string | null = null;
  private lastPlus: boolean;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private recheckTimer: number | undefined;
  private state: RemoteHostViewState;

  constructor(private readonly deps: RemoteHostServiceDeps) {
    this.server = new RemoteServer({
      desktopName: deps.desktopName,
      consumePairingSecret: (secret) => deps.isPlus() && deps.pairing.consume(secret),
      devices: {
        authenticate: (token) => (deps.isPlus() ? deps.store.authenticate(token) : null),
        create: (name, clientId) => deps.store.create(name, clientId),
        markSeen: (id) => deps.store.markSeen(id),
      },
    });
    this.lastPlus = deps.isPlus();
    this.tailscaleAddress = deps.findTailscaleAddress();
    this.state = this.buildState();
    this.cleanups.push(
      deps.pairing.subscribe(() => void this.reconcile()),
      deps.store.subscribe(() => void this.reconcile()),
      this.server.onConnectionsChanged(() => this.publish()),
      deps.subscribePlus(() => {
        const plus = deps.isPlus();
        if (plus === this.lastPlus) return;
        this.lastPlus = plus;
        void this.reconcile();
      })
    );
  }

  getState = (): RemoteHostViewState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onConnection(handler: (connection: RemoteConnection) => void): () => void {
    return this.server.onConnection(handler);
  }

  start(): Promise<void> {
    return this.reconcile();
  }

  async recheck(): Promise<void> {
    this.error = null;
    await this.reconcile();
  }

  async startPairing(): Promise<void> {
    if (!this.deps.isPlus()) return;
    this.error = null;
    this.tailscaleAddress = this.deps.findTailscaleAddress();
    if (!this.tailscaleAddress) {
      this.publish();
      return;
    }
    this.deps.pairing.start();
    await this.queue;
  }

  cancelPairing(): void {
    this.deps.pairing.cancel();
  }

  revokeDevice(deviceId: string): void {
    this.deps.store.revoke(deviceId);
    this.server.disconnectDevice(deviceId);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.deps.pairing.dispose();
    window.clearTimeout(this.recheckTimer);
    await this.queue;
    await this.server.close();
    this.listening = null;
    this.listeners.clear();
  }

  private reconcile(): Promise<void> {
    this.queue = this.queue.then(() => this.applyDesiredState()).catch(() => {});
    return this.queue;
  }

  private async applyDesiredState(): Promise<void> {
    if (this.disposed) return;
    try {
      this.tailscaleAddress = this.deps.findTailscaleAddress();
      const address = this.tailscaleAddress;
      const demanded = this.deps.store.list().length > 0 || this.deps.pairing.getActive() !== null;
      const shouldListen = this.deps.isPlus() && demanded && address !== null;
      this.scheduleRecheck(demanded);

      if (!shouldListen) {
        await this.stopListening();
      } else {
        if (this.listening?.host !== address) {
          await this.stopListening();
          await this.startListening(address);
        }
        this.error = null;
      }
    } catch (error) {
      logError("Remote listener could not be reconciled", error);
      this.error = "Copilot could not start the Remote listener. Check the logs and try again.";
      await this.stopListening().catch(() => {});
      this.deps.pairing.cancel();
    }
    this.publish();
  }

  // Nothing announces a change of Tailscale's address, of the entitlement (which also expires by
  // the clock and finishes verifying after startup) or of a port that was busy at startup, so
  // while a phone is paired or a pairing is open the listener is reconciled on a timer. The port must
  // not outlive the Tailscale interface it was bound to. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  private scheduleRecheck(needed: boolean): void {
    if (!needed) {
      window.clearTimeout(this.recheckTimer);
      this.recheckTimer = undefined;
      return;
    }
    if (this.recheckTimer !== undefined) return;
    this.recheckTimer = window.setTimeout(() => {
      this.recheckTimer = undefined;
      void this.reconcile();
    }, RECHECK_INTERVAL_MS);
  }

  private async startListening(host: string): Promise<void> {
    const remembered = this.deps.port.load();
    let port: number;
    try {
      port = await this.server.listen(host, remembered ?? 0);
    } catch (error) {
      // A paired phone stores the port, so moving to another port strands it. Only a service
      // with no paired device may fall back to a fresh port.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      if (!remembered || !isAddressInUse(error) || this.deps.store.list().length > 0) throw error;
      port = await this.server.listen(host, 0);
    }
    if (port !== remembered) this.deps.port.save(port);
    this.listening = { host, port };
    logInfo("Remote listener started");
  }

  private async stopListening(): Promise<void> {
    if (!this.listening) return;
    this.listening = null;
    await this.server.close();
    logInfo("Remote listener stopped");
  }

  private buildState(): RemoteHostViewState {
    const { pairing, vault } = this.deps;
    const activePairing = this.listening ? pairing.getActive() : null;
    const stored = this.readDevices();
    return {
      plus: this.deps.isPlus(),
      tailscaleAddress: this.tailscaleAddress,
      listening: this.listening !== null,
      pairing:
        activePairing && this.listening
          ? {
              expiresAt: activePairing.expiresAt,
              link: buildPairingLink({
                host: this.listening.host,
                port: this.listening.port,
                vaultName: vault.name,
                vaultId: vault.id,
                secret: activePairing.secret,
                desktopName: this.deps.desktopName,
              }),
            }
          : null,
      devices:
        stored.length === 0
          ? EMPTY_DEVICES
          : stored.map((device) => ({
              id: device.id,
              name: device.name,
              createdAt: device.createdAt,
              lastSeenAt: device.lastSeenAt,
              connected: this.server.isDeviceConnected(device.id),
            })),
      error: this.error,
    };
  }

  private readDevices(): readonly PairedDevice[] {
    try {
      return this.deps.store.list();
    } catch {
      return NO_STORED_DEVICES;
    }
  }

  private publish(): void {
    if (this.disposed) return;
    this.state = this.buildState();
    for (const listener of [...this.listeners]) listener();
  }
}
