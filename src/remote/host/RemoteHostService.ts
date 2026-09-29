import { logError, logInfo } from "@/logger";
import { buildPairingLink } from "@/remote/pairingLink";
import type { PairedDeviceView, RemoteHostViewState } from "@/remote/hostState";
import type { PairedDevice, PairedDeviceStore } from "@/remote/host/PairedDeviceStore";
import type { PairingWindow } from "@/remote/host/PairingWindow";
import { RemoteServer, type RemoteConnection } from "@/remote/host/RemoteServer";

export const ADDRESS_RETRY_MS = 15_000;

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
  private addressRetryTimer: number | undefined;
  private state: RemoteHostViewState;

  constructor(private readonly deps: RemoteHostServiceDeps) {
    this.server = new RemoteServer({
      desktopName: deps.desktopName,
      consumePairingSecret: (secret) => deps.isPlus() && deps.pairing.consume(secret),
      devices: {
        authenticate: (token) => (deps.isPlus() ? deps.store.authenticate(token) : null),
        create: (name) => deps.store.create(name),
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
    window.clearTimeout(this.addressRetryTimer);
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
      const wanted =
        this.deps.isPlus() &&
        (this.deps.store.list().length > 0 || this.deps.pairing.getActive() !== null);
      const shouldListen = wanted && address !== null;
      this.scheduleAddressRetry(wanted && address === null);

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

  // Obsidian can start before Tailscale has an address, and a paired phone then finds nothing
  // listening until the next reconcile. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  private scheduleAddressRetry(needed: boolean): void {
    if (!needed) {
      window.clearTimeout(this.addressRetryTimer);
      this.addressRetryTimer = undefined;
      return;
    }
    if (this.addressRetryTimer !== undefined) return;
    this.addressRetryTimer = window.setTimeout(() => {
      this.addressRetryTimer = undefined;
      void this.reconcile();
    }, ADDRESS_RETRY_MS);
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
