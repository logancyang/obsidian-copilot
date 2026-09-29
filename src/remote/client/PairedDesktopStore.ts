export interface SecretSlot {
  read(): string | null;
  write(value: string): void;
}

export interface PairedDesktop {
  id: string;
  host: string;
  port: number;
  token: string;
  desktopName: string;
  vaultName: string;
  pairedAt: number;
}

interface StoredDesktops {
  version: 1;
  desktops: PairedDesktop[];
}

const EMPTY_DESKTOPS: readonly PairedDesktop[] = Object.freeze([]);

function isPairedDesktop(value: unknown): value is PairedDesktop {
  if (!value || typeof value !== "object") return false;
  const desktop = value as Record<string, unknown>;
  return (
    typeof desktop.id === "string" &&
    typeof desktop.host === "string" &&
    typeof desktop.port === "number" &&
    typeof desktop.token === "string" &&
    typeof desktop.desktopName === "string" &&
    typeof desktop.vaultName === "string" &&
    typeof desktop.pairedAt === "number"
  );
}

export class PairedDesktopStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly PairedDesktop[] = EMPTY_DESKTOPS;
  private snapshotSource: string | null | undefined;

  constructor(private readonly slot: SecretSlot) {}

  list = (): readonly PairedDesktop[] => {
    try {
      return this.readSaved();
    } catch {
      return EMPTY_DESKTOPS;
    }
  };

  add(desktop: PairedDesktop): void {
    const others = this.readSaved().filter(
      (existing) => existing.host !== desktop.host || existing.port !== desktop.port
    );
    this.write([...others, desktop]);
  }

  remove(id: string): void {
    this.write(this.readSaved().filter((desktop) => desktop.id !== id));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // A read that fails is not an empty store: add() and remove() would overwrite every saved token
  // with the result, so they use this and let the failure propagate. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  private readSaved(): readonly PairedDesktop[] {
    const raw = this.slot.read();
    if (raw === this.snapshotSource) return this.snapshot;
    const desktops = this.parse(raw);
    this.snapshot = desktops.length === 0 ? EMPTY_DESKTOPS : desktops;
    this.snapshotSource = raw;
    return this.snapshot;
  }

  private parse(raw: string | null): PairedDesktop[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Partial<StoredDesktops> | null;
      return Array.isArray(parsed?.desktops) ? parsed.desktops.filter(isPairedDesktop) : [];
    } catch {
      return [];
    }
  }

  private write(desktops: readonly PairedDesktop[]): void {
    const payload: StoredDesktops = { version: 1, desktops: [...desktops] };
    this.slot.write(JSON.stringify(payload));
    for (const listener of [...this.listeners]) listener();
  }
}
