import { type App, type SecretStorage, FileSystemAdapter } from "obsidian";
import { type CopilotSettings, getModelKeyFromModel, getSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
import type { Provider } from "@/modelManagement";
import {
  stripKeychainFields,
  cleanupLegacyFields,
  isSensitiveKey,
  MODEL_SECRET_FIELDS,
  TOP_LEVEL_SECRET_FIELDS,
} from "@/services/settingsSecretTransforms";
import { Notice } from "obsidian";
import { md5 } from "@/utils/hash";
import { logError, logWarn } from "@/logger";

const EXTRA_SECRET_KEYS: readonly string[] = [];

type ModelSecretField = (typeof MODEL_SECRET_FIELDS)[number];

type ModelScope = "chat";

export function isSecretKey(key: string): boolean {
  return isSensitiveKey(key) || EXTRA_SECRET_KEYS.includes(key);
}

// Names must not depend on the device: `data.json` syncs, the Keychain does not, so a synced
// pointer has to resolve on every device that holds the key.
// https://github.com/logancyang/obsidian-copilot/issues/3618
const COPILOT_SECRET_PREFIX = "copilot-";
const LEGACY_SECRET_ID = /^copilot-v([0-9a-f]{8})-/;
const RETIRED_EMBEDDING_SECRET_ID = /^copilot-v[0-9a-f]{8}-model-api-key-embedding-/;
const MAX_SECRET_ID_LENGTH = 64;
const API_KEY_SUFFIX = "-api-key";

function legacyVaultIdForPath(app: App): string | undefined {
  const basePath = getVaultBasePath(app);
  return basePath ? md5(basePath).slice(0, 8) : undefined;
}

function getVaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }
  const adapterAny = adapter as unknown as { getBasePath?: () => string; basePath?: string };
  if (typeof adapterAny.getBasePath === "function") {
    return adapterAny.getBasePath();
  }
  if (typeof adapterAny.basePath === "string") {
    return adapterAny.basePath;
  }
  return undefined;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeKeychainId(raw: string, maxLength = MAX_SECRET_ID_LENGTH): string {
  const hash = md5(raw).slice(0, 8);
  const prefixBudget = Math.max(0, maxLength - 9);
  const prefix = slugify(raw).slice(0, prefixBudget);
  return prefix + "-" + hash;
}

function kebabCase(key: string): string {
  return key
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
}

function fitSecretId(id: string, hashSource: string): string {
  if (id.length <= MAX_SECRET_ID_LENGTH) return id;
  return id.slice(0, MAX_SECRET_ID_LENGTH - 9) + "-" + md5(hashSource).slice(0, 8);
}

function toKeychainId(settingsKey: string): string {
  return fitSecretId(`${COPILOT_SECRET_PREFIX}setting-${kebabCase(settingsKey)}`, settingsKey);
}

function toLegacyKeychainId(vaultId: string, settingsKey: string): string {
  return fitSecretId(`copilot-v${vaultId}-${kebabCase(settingsKey)}`, settingsKey);
}

function modelKeychainId(
  prefix: string,
  scope: ModelScope,
  modelIdentity: string,
  field: ModelSecretField
): string {
  const fullPrefix = `${prefix}model-${kebabCase(field)}-${scope}-`;
  return fullPrefix + normalizeKeychainId(modelIdentity, MAX_SECRET_ID_LENGTH - fullPrefix.length);
}

function toModelKeychainId(
  scope: ModelScope,
  modelIdentity: string,
  field: ModelSecretField
): string {
  return modelKeychainId(COPILOT_SECRET_PREFIX, scope, modelIdentity, field);
}

function toLegacyModelKeychainId(
  vaultId: string,
  scope: ModelScope,
  modelIdentity: string,
  field: ModelSecretField
): string {
  return modelKeychainId(`copilot-v${vaultId}-`, scope, modelIdentity, field);
}

function providerNameSource(provider: Provider): string {
  switch (provider.origin.kind) {
    case "byok":
      return provider.origin.catalogProviderId ?? provider.displayName;
    case "agent":
      return provider.displayName;
    case "copilot-plus":
      return "plus";
  }
}

export function providerKeychainName(
  provider: Provider,
  providers: Record<string, Provider>
): string {
  const taken = new Set(
    Object.values(providers)
      .filter((row) => row.providerId !== provider.providerId)
      .map((row) => row.apiKeyKeychainId)
  );
  const slugBudget =
    MAX_SECRET_ID_LENGTH - COPILOT_SECRET_PREFIX.length - API_KEY_SUFFIX.length - "-99".length;
  const slug =
    slugify(providerNameSource(provider)).slice(0, slugBudget).replace(/-$/, "") || "provider";
  const base = `${COPILOT_SECRET_PREFIX}${slug}${API_KEY_SUFFIX}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

export function isCopilotOwnedSecret(id: string): boolean {
  return id.startsWith(COPILOT_SECRET_PREFIX);
}

export interface HydrateResult {
  settings: CopilotSettings;
  hadFailures: boolean;
}

export interface PersistSecretsResult {
  secretEntries: Array<[string, string]>;
  keychainIdsToDelete: string[];
}

export type SaveDataFn = (data: CopilotSettings) => Promise<void>;

function topLevelSecretKeys(settings: CopilotSettings): Set<string> {
  return new Set<string>([
    ...TOP_LEVEL_SECRET_FIELDS,
    ...Object.keys(settings).filter((key) => isSecretKey(key)),
  ]);
}

export class KeychainService {
  private static instance: KeychainService | null = null;
  private app: App;

  private constructor(app: App) {
    this.app = app;
  }

  static getInstance(app?: App): KeychainService {
    if (!KeychainService.instance) {
      if (!app) {
        throw new Error("KeychainService must be initialized with app on first call");
      }
      KeychainService.instance = new KeychainService(app);
    }
    return KeychainService.instance;
  }

  static resetInstance(): void {
    KeychainService.instance = null;
  }

  isAvailable(): boolean {
    return !!this.app.secretStorage;
  }

  private get storage(): SecretStorage {
    if (!this.app.secretStorage) {
      throw new Error("OS keychain (SecretStorage) is not available.");
    }
    return this.app.secretStorage;
  }

  private removeSecret(id: string): void {
    if (typeof this.storage.deleteSecret === "function") {
      this.storage.deleteSecret(id);
    } else {
      this.storage.setSecret(id, "");
    }
  }

  setSecretById(keychainId: string, value: string): void {
    this.storage.setSecret(keychainId, value);
  }

  getSecretById(keychainId: string): string | null {
    return this.storage.getSecret(keychainId);
  }

  deleteSecretById(keychainId: string): void {
    this.removeSecret(keychainId);
  }

  deleteSecret(settingsKey: string): void {
    this.removeSecret(toKeychainId(settingsKey));
  }

  getSecret(settingsKey: string): string | null {
    const id = toKeychainId(settingsKey);
    return this.storage.getSecret(id);
  }

  getModelSecret(scope: ModelScope, modelIdentity: string, field: ModelSecretField): string | null {
    const id = toModelKeychainId(scope, modelIdentity, field);
    return this.storage.getSecret(id);
  }

  async hydrateFromKeychain(settings: CopilotSettings): Promise<HydrateResult> {
    const hydrated = { ...settings };
    let hadFailures = false;

    for (const key of topLevelSecretKeys(hydrated)) {
      let keychainValue: string | null;
      try {
        keychainValue = this.getSecret(key);
      } catch (e) {
        logWarn(`Keychain read failed for "${key}".`, e);
        hadFailures = true;
        continue;
      }

      if (keychainValue === "") {
        (hydrated as unknown as Record<string, unknown>)[key] = "";
      } else if (keychainValue !== null) {
        (hydrated as unknown as Record<string, unknown>)[key] = keychainValue;
      }
    }

    const modelResult = await this.hydrateModelSecrets("chat", hydrated.activeModels ?? []);
    hydrated.activeModels = modelResult.models;
    hadFailures = hadFailures || modelResult.hadFailures;

    if (hadFailures) {
      logWarn("Keychain hydrate: some keychain reads failed — values left as-is.");
    }

    return { settings: hydrated, hadFailures };
  }

  persistSecrets(settings: CopilotSettings, prevSettings?: CopilotSettings): PersistSecretsResult {
    const secretEntries: Array<[string, string]> = [];
    const clearedSecretIds: string[] = [];

    for (const key of Object.keys(settings)) {
      if (!isSecretKey(key)) continue;
      const value = (settings as unknown as Record<string, unknown>)[key];
      const id = toKeychainId(key);

      if (typeof value === "string" && value.length > 0) {
        secretEntries.push([id, value]);
      } else if (prevSettings) {
        const prevValue = (prevSettings as unknown as Record<string, unknown>)[key];
        if (typeof prevValue === "string" && prevValue.length > 0) {
          clearedSecretIds.push(id);
        }
      }
    }

    this.collectModelSecrets(
      "chat",
      settings.activeModels,
      secretEntries,
      prevSettings?.activeModels,
      clearedSecretIds
    );
    const keychainIdsToDelete = [
      ...this.getDeletedModelKeysForScope(
        "chat",
        prevSettings?.activeModels,
        settings.activeModels
      ),
      ...clearedSecretIds,
    ];

    return { secretEntries, keychainIdsToDelete };
  }

  migrateLegacyNames(settings: CopilotSettings, rawVaultIdHint: unknown): CopilotSettings {
    const vaultIds = this.legacyVaultIds(rawVaultIdHint);
    const adopt = (name: string, legacyIdFor: (vaultId: string) => string): void => {
      if (this.storage.getSecret(name) !== null) return;
      for (const vaultId of vaultIds) {
        const value = this.storage.getSecret(legacyIdFor(vaultId));
        if (value !== null) {
          this.storage.setSecret(name, value);
          return;
        }
      }
    };

    for (const key of topLevelSecretKeys(settings)) {
      adopt(toKeychainId(key), (vaultId) => toLegacyKeychainId(vaultId, key));
    }
    for (const model of settings.activeModels ?? []) {
      const identity = getModelKeyFromModel(model);
      for (const field of MODEL_SECRET_FIELDS) {
        adopt(toModelKeychainId("chat", identity, field), (vaultId) =>
          toLegacyModelKeychainId(vaultId, "chat", identity, field)
        );
      }
    }

    const providers = { ...(settings.providers ?? {}) };
    let pointersChanged = false;
    for (const row of Object.values(settings.providers ?? {})) {
      const pointer = row.apiKeyKeychainId;
      if (!pointer) continue;
      const name = LEGACY_SECRET_ID.test(pointer) ? providerKeychainName(row, providers) : pointer;
      adopt(name, (vaultId) => `copilot-v${vaultId}-provider-${row.providerId}`);
      if (name !== pointer) {
        providers[row.providerId] = { ...row, apiKeyKeychainId: name };
        pointersChanged = true;
      }
    }
    return pointersChanged ? { ...settings, providers } : settings;
  }

  private legacyVaultIds(rawVaultIdHint: unknown): string[] {
    const hint =
      typeof rawVaultIdHint === "string" && /^[0-9a-f]{8}$/.test(rawVaultIdHint)
        ? rawVaultIdHint
        : undefined;
    const stored = this.storage
      .listSecrets()
      .map((id) => LEGACY_SECRET_ID.exec(id)?.[1])
      .filter((id): id is string => id !== undefined);
    const local = legacyVaultIdForPath(this.app);
    return [...new Set([local, hint, ...stored].filter((id): id is string => !!id))];
  }

  removeRetiredEmbeddingSecrets(): void {
    if (typeof this.storage.listSecrets !== "function") return;

    for (const id of this.storage.listSecrets()) {
      if (!RETIRED_EMBEDDING_SECRET_ID.test(id)) continue;
      try {
        this.removeSecret(id);
      } catch (error) {
        logWarn(`Keychain: failed to remove retired embedding secret ${id}`, error);
      }
    }
  }

  clearCopilotSecrets(): void {
    if (typeof this.storage.listSecrets !== "function") {
      throw new Error(
        "Obsidian Keychain on this build does not support listing entries; " +
          "cannot guarantee a complete clear."
      );
    }
    const allIds = this.storage.listSecrets();
    const failures: string[] = [];
    for (const id of allIds) {
      if (isCopilotOwnedSecret(id)) {
        try {
          this.removeSecret(id);
        } catch {
          failures.push(id);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Failed to clear ${failures.length} keychain ` +
          `entr${failures.length === 1 ? "y" : "ies"}. Please retry.`
      );
    }
  }

  async forgetAllSecrets(
    saveData: SaveDataFn,
    syncMemory: (data: Partial<CopilotSettings>) => void
  ): Promise<void> {
    const current = getSettings();
    if (!this.isAvailable()) {
      throw new Error(
        "Cannot delete API keys from the Obsidian Keychain because Secure Storage is " +
          "unavailable in this Obsidian build. Update Obsidian to 1.11.4 or later, or open " +
          "this vault on a device with Keychain access, then try again."
      );
    }
    if (typeof this.app.secretStorage?.listSecrets !== "function") {
      throw new Error(
        "Cannot delete all API keys because this Obsidian build does not support " +
          "enumerating Keychain entries. Update Obsidian to a newer version and retry."
      );
    }

    const stripped = stripKeychainFields(current);

    const toSave = cleanupLegacyFields(stripped);
    try {
      await saveData(toSave);
    } catch (error) {
      logError("forgetAllSecrets: saveData failed — aborting keychain clear", error);
      new Notice(
        "Failed to remove API keys from data.json. Obsidian Keychain was NOT cleared. Please try again."
      );
      return;
    }

    let keychainError: Error | undefined;
    try {
      this.clearCopilotSecrets();
    } catch (e) {
      keychainError = e instanceof Error ? e : new Error(String(e));
    }

    syncMemory(stripped);

    if (keychainError) {
      new Notice(
        "Some Obsidian Keychain entries could not be removed. " +
          "Your keys have been cleared from data.json and memory. Please restart and retry."
      );
      throw keychainError;
    }

    new Notice("All API keys for this vault removed. Please re-enter them.");
  }

  private async hydrateModelSecrets(
    scope: ModelScope,
    models: CustomModel[]
  ): Promise<{ models: CustomModel[]; hadFailures: boolean }> {
    if (!models?.length) return { models, hadFailures: false };

    let hadFailures = false;
    const result: CustomModel[] = [];

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const copy = { ...model };

      for (const field of MODEL_SECRET_FIELDS) {
        let keychainValue: string | null;
        try {
          keychainValue = this.getModelSecret(scope, identity, field);
        } catch (e) {
          logWarn(`Keychain read failed for model "${identity}" field "${field}".`, e);
          hadFailures = true;
          continue;
        }

        if (keychainValue === "") {
          (copy as unknown as Record<string, unknown>)[field] = "";
        } else if (keychainValue !== null) {
          (copy as unknown as Record<string, unknown>)[field] = keychainValue;
        }
      }

      result.push(copy);
    }

    return { models: result, hadFailures };
  }

  private collectModelSecrets(
    scope: ModelScope,
    models: CustomModel[],
    secretEntries: Array<[string, string]>,
    prevModels?: CustomModel[],
    clearedSecretIds?: string[]
  ): void {
    if (!models?.length) return;

    const prevModelMap = new Map<string, CustomModel>();
    if (prevModels) {
      for (const m of prevModels) {
        prevModelMap.set(getModelKeyFromModel(m), m);
      }
    }

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const prevModel = prevModelMap.get(identity);

      for (const field of MODEL_SECRET_FIELDS) {
        const value = model[field];
        const id = toModelKeychainId(scope, identity, field);

        if (typeof value === "string" && value.length > 0) {
          secretEntries.push([id, value]);
        } else if (prevModel && clearedSecretIds) {
          const prevValue = prevModel[field];
          if (typeof prevValue === "string" && prevValue.length > 0) {
            clearedSecretIds.push(id);
          }
        }
      }
    }
  }

  private getDeletedModelKeysForScope(
    scope: ModelScope,
    prevModels: CustomModel[] | undefined,
    currentModels: CustomModel[]
  ): string[] {
    if (!prevModels?.length) return [];

    const currentIds = new Set((currentModels ?? []).map(getModelKeyFromModel));

    return prevModels
      .filter((m) => !currentIds.has(getModelKeyFromModel(m)))
      .flatMap((m) => {
        const identity = getModelKeyFromModel(m);
        return MODEL_SECRET_FIELDS.flatMap((field) => {
          const prevValue = (m as unknown as Record<string, unknown>)[field];
          if (typeof prevValue !== "string" || prevValue.length === 0) {
            return [];
          }
          return [toModelKeychainId(scope, identity, field)];
        });
      });
  }
}
