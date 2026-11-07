import {
  parseCustomConnectors,
  type CustomConnectorConfig,
  type CustomConnectorParse,
  type ParsedCustomConnector,
} from "@/connectors/custom/customConnectorConfig";
import { logWarn } from "@/logger";
import type { KeychainService } from "@/services/keychainService";
import { getSettings, updateSetting } from "@/settings/model";

export type CustomConnectorStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "needs-key" }
  | { readonly kind: "off" };

export interface CustomConnectorState {
  readonly config: CustomConnectorConfig;
  readonly status: CustomConnectorStatus;
}

export interface CustomConnectorsSnapshot {
  readonly connectors: readonly CustomConnectorState[];
  readonly needsAttention: boolean;
}

export interface CustomConnectorsDeps {
  keychain: Pick<
    KeychainService,
    "getVaultId" | "getSecretById" | "setSecretById" | "deleteSecretById"
  >;
  deviceStorage: { load(key: string): unknown; save(key: string, value: unknown): void };
  catalogIds: readonly string[];
}

// Turning a connector off is a choice for one device, so it lives in this vault's local storage on that device rather than in synced settings.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/862
const OFF_STORAGE_KEY = "copilot-custom-connectors-off";
const IDLE: CustomConnectorStatus = Object.freeze({ kind: "idle" });
const NEEDS_KEY: CustomConnectorStatus = Object.freeze({ kind: "needs-key" });
const OFF: CustomConnectorStatus = Object.freeze({ kind: "off" });
const ATTENTION_KINDS: ReadonlySet<CustomConnectorStatus["kind"]> = new Set(["needs-key"]);
const EMPTY_CUSTOM_CONNECTORS: readonly CustomConnectorState[] = Object.freeze([]);

export class CustomConnectors {
  private readonly listeners = new Set<() => void>();
  private snapshot: CustomConnectorsSnapshot;

  constructor(private readonly deps: CustomConnectorsDeps) {
    this.snapshot = this.buildSnapshot();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): CustomConnectorsSnapshot => this.snapshot;

  parse(text: string): CustomConnectorParse {
    const taken = [...this.deps.catalogIds, ...configs().map(({ id }) => id)];
    return parseCustomConnectors(text, new Set(taken));
  }

  add(connectors: readonly ParsedCustomConnector[]): void {
    for (const { config, secrets } of connectors) this.saveSecrets(config.id, secrets);
    updateSetting("customConnectors", [...configs(), ...connectors.map(({ config }) => config)]);
    this.publish();
  }

  edit(id: string, text: string): CustomConnectorParse {
    const parsed = parseCustomConnectors(text, new Set());
    if (!parsed.ok) return parsed;
    if (parsed.connectors.length !== 1) {
      return { ok: false, error: "Paste one server to edit this connector." };
    }
    const [{ config, secrets }] = parsed.connectors;
    const edited = { ...config, id };
    const stored = this.secretsOf(id);
    // Edit shows each value blank because values never leave the keychain, so a value left blank keeps the stored one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    this.saveSecrets(
      id,
      Object.fromEntries(secretNames(edited).map((name) => [name, secrets[name] || stored[name]]))
    );
    updateSetting(
      "customConnectors",
      configs().map((existing) => (existing.id === id ? edited : existing))
    );
    this.publish();
    return { ok: true, connectors: [{ config: edited, secrets }] };
  }

  remove(id: string): void {
    this.deps.keychain.deleteSecretById(this.keychainId(id));
    this.saveOffIds([...this.offIds()].filter((offId) => offId !== id));
    updateSetting(
      "customConnectors",
      configs().filter((config) => config.id !== id)
    );
    this.publish();
  }

  setTurnedOff(id: string, off: boolean): void {
    const offIds = this.offIds();
    if (off) offIds.add(id);
    else offIds.delete(id);
    this.saveOffIds([...offIds]);
    this.publish();
  }

  private keychainId(id: string): string {
    return `copilot-v${this.deps.keychain.getVaultId()}-custom-connector-${id}`;
  }

  private secretsOf(id: string): Record<string, string> {
    try {
      const raw = this.deps.keychain.getSecretById(this.keychainId(id));
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch (error) {
      logWarn(`[Connectors] Couldn't read the keychain values of ${id}`, error);
      return {};
    }
  }

  private saveSecrets(id: string, secrets: Readonly<Record<string, string>>): void {
    const filled = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value));
    if (Object.keys(filled).length === 0) this.deps.keychain.deleteSecretById(this.keychainId(id));
    else this.deps.keychain.setSecretById(this.keychainId(id), JSON.stringify(filled));
  }

  private offIds(): Set<string> {
    const stored = this.deps.deviceStorage.load(OFF_STORAGE_KEY);
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
  }

  private saveOffIds(ids: readonly string[]): void {
    this.deps.deviceStorage.save(OFF_STORAGE_KEY, ids);
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): CustomConnectorsSnapshot {
    const offIds = this.offIds();
    const connectors = configs().map((config) => {
      const secrets = this.secretsOf(config.id);
      const status = offIds.has(config.id)
        ? OFF
        : secretNames(config).some((name) => !secrets[name])
          ? NEEDS_KEY
          : IDLE;
      return Object.freeze({ config, status });
    });
    return Object.freeze({
      connectors: connectors.length > 0 ? Object.freeze(connectors) : EMPTY_CUSTOM_CONNECTORS,
      needsAttention: connectors.some(({ status }) => ATTENTION_KINDS.has(status.kind)),
    });
  }
}

function configs(): readonly CustomConnectorConfig[] {
  return getSettings().customConnectors;
}

function secretNames(config: CustomConnectorConfig): readonly string[] {
  return "command" in config ? config.envNames : config.headerNames;
}
