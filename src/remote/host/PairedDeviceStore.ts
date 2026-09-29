import { digestsEqual, sha256Hex } from "@/remote/host/digest";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface SecretSlot {
  read(): string | null;
  write(value: string): void;
}

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

interface StoredDevice extends PairedDevice {
  tokenHash: string;
  clientId?: string;
}

interface StoredDevices {
  version: 1;
  devices: StoredDevice[];
}

const EMPTY_DEVICES: readonly PairedDevice[] = Object.freeze([]);
const MAX_DEVICE_NAME_LENGTH = 60;
const DEFAULT_DEVICE_NAME = "Phone";

function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex -- strips control characters from a name typed on another device
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, MAX_DEVICE_NAME_LENGTH) || DEFAULT_DEVICE_NAME;
}

function withoutHash(stored: StoredDevice): PairedDevice {
  return {
    id: stored.id,
    name: stored.name,
    createdAt: stored.createdAt,
    lastSeenAt: stored.lastSeenAt,
  };
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== "object") return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.tokenHash === "string" &&
    (device.clientId === undefined || typeof device.clientId === "string") &&
    typeof device.createdAt === "number" &&
    (device.lastSeenAt === null || typeof device.lastSeenAt === "number")
  );
}

export class PairedDeviceStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly PairedDevice[] = EMPTY_DEVICES;
  private snapshotSource: string | null | undefined;

  constructor(
    private readonly slot: SecretSlot,
    private readonly now: () => number = Date.now
  ) {}

  list(): readonly PairedDevice[] {
    const raw = this.slot.read();
    if (raw === this.snapshotSource) return this.snapshot;
    const devices = this.readStored().map(withoutHash);
    this.snapshot = devices.length === 0 ? EMPTY_DEVICES : devices;
    this.snapshotSource = raw;
    return this.snapshot;
  }

  /**
   * Records a newly paired device and issues its token. A phone that pairs again sends the same
   * `clientId`, so its earlier entries are removed and returned as `replacedDeviceIds` for the
   * caller to disconnect. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
   *
   * @param deviceName - The name the phone reports for itself.
   * @param clientId - The phone's stable id, absent when the pairing cannot be matched to an earlier one.
   */
  create(
    deviceName: string,
    clientId?: string
  ): { device: PairedDevice; token: string; replacedDeviceIds: string[] } {
    const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
    const token = crypto.randomBytes(32).toString("base64url");
    const stored: StoredDevice = {
      id: crypto.randomUUID(),
      name: cleanName(deviceName),
      tokenHash: sha256Hex(token),
      createdAt: this.now(),
      lastSeenAt: null,
      ...(clientId ? { clientId } : {}),
    };
    const earlier = this.readStored();
    const replaced = clientId ? earlier.filter((device) => device.clientId === clientId) : [];
    this.writeStored([...earlier.filter((device) => !replaced.includes(device)), stored]);
    return {
      device: withoutHash(stored),
      token,
      replacedDeviceIds: replaced.map((device) => device.id),
    };
  }

  authenticate(token: string): PairedDevice | null {
    const presented = sha256Hex(token);
    let match: StoredDevice | null = null;
    for (const stored of this.readStored()) {
      if (digestsEqual(presented, stored.tokenHash)) match = stored;
    }
    return match ? withoutHash(match) : null;
  }

  markSeen(deviceId: string): void {
    const stored = this.readStored();
    if (!stored.some((device) => device.id === deviceId)) return;
    const seenAt = this.now();
    this.writeStored(
      stored.map((device) => (device.id === deviceId ? { ...device, lastSeenAt: seenAt } : device))
    );
  }

  revoke(deviceId: string): boolean {
    const stored = this.readStored();
    const remaining = stored.filter((device) => device.id !== deviceId);
    if (remaining.length === stored.length) return false;
    this.writeStored(remaining);
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readStored(): StoredDevice[] {
    const raw = this.slot.read();
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      const devices = (parsed as Partial<StoredDevices> | null)?.devices;
      return Array.isArray(devices) ? devices.filter(isStoredDevice) : [];
    } catch {
      return [];
    }
  }

  private writeStored(devices: StoredDevice[]): void {
    const payload: StoredDevices = { version: 1, devices };
    this.slot.write(JSON.stringify(payload));
    for (const listener of [...this.listeners]) listener();
  }
}
