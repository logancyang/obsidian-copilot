/**
 * Source of truth for `Provider` rows.
 *
 * Wraps `settings.providers: Record<providerId, Provider>` with typed
 * reads, mutations, and keychain bridging. React components consume
 * reactive reads through the atoms in `state/atoms.ts`; this class is
 * for mutations and for non-React callers (the chat-model factory, the
 * setup APIs, the coordinator).
 *
 * Cascade semantics — `remove()` does NOT cascade to ConfiguredModels
 * or BackendConfigs on its own. Call `ModelManagementCoordinator.removeProvider`
 * from UI code; the coordinator orchestrates the cross-slice
 * removal. This method exists for the coordinator's use.
 *
 * Referential stability — read methods cache their result keyed on the
 * source-slice reference (`getSettings().providers`). On a cache hit
 * (slice unchanged since last call) the same array reference is
 * returned, which is what Jotai derived atoms and React memoization
 * rely on. See AGENTS.md → "Referential stability".
 */

import type { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import { logError, logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { getSettings, setSettings } from "@/settings/model";
import { frozenOr, sliceMemo, sliceMemoByKey } from "@/utils/sliceCache";

import type { ProviderType } from "@/modelManagement/types/catalog";
import type { Provider, ProviderOrigin } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { ProviderAdapterRegistry } from "./adapters/ProviderAdapterRegistry";

// Frozen empty shared across all filtered views so consumers see a
// stable reference even when two distinct filters both yield zero rows.
const EMPTY_LIST: readonly Provider[] = Object.freeze([]);

/** Format the legacy opaque keychain ID for a provider.
 *
 * Kept so existing credentials can be copied to readable IDs without re-entry. */
function legacyProviderKeychainId(vaultId: string, providerId: string): string {
  return `copilot-v${vaultId}-provider-${providerId}`;
}

export class ProviderRegistry {
  readonly #app: App;
  readonly #adapters: ProviderAdapterRegistry;

  readonly #list = sliceMemo((source: Record<string, Provider>) =>
    frozenOr(Object.values(source), EMPTY_LIST)
  );
  readonly #byOrigin = sliceMemoByKey(
    (source: Record<string, Provider>, kind: ProviderOrigin["kind"]) =>
      frozenOr(
        Object.values(source).filter((p) => p.origin.kind === kind),
        EMPTY_LIST
      )
  );
  readonly #byType = sliceMemoByKey(
    (source: Record<string, Provider>, providerType: ProviderType) =>
      frozenOr(
        Object.values(source).filter((p) => p.providerType === providerType),
        EMPTY_LIST
      )
  );

  // Listeners fire after a mutation that may change spawn-time config for
  // any consumer that bakes provider config (notably the opencode backend's
  // `OPENCODE_CONFIG_CONTENT`). Settings changes are already broadcast via
  // `subscribeToSettingsChange`, but `setApiKey` only writes settings when
  // the keychain id rotates — a same-id key change is invisible there. A
  // dedicated emitter keeps both signals on one channel for consumers.
  readonly #listeners = new Set<() => void>();

  constructor(app: App, adapters: ProviderAdapterRegistry) {
    this.#app = app;
    this.#adapters = adapters;
  }

  /** Subscribe to provider/key mutations. Returns unsubscribe. Fires after
   *  the change has been persisted (settings + keychain). */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (err) {
        logError("[modelManagement] ProviderRegistry listener threw", err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reads — synchronous, backed by `settings.providers`.
  // -------------------------------------------------------------------------

  /** All providers. Use the atoms in `state/atoms.ts` for reactive
   *  React reads; this method is for non-React callers. */
  list(): readonly Provider[] {
    return this.#list(getSettings().providers);
  }

  get(providerId: string): Provider | undefined {
    return getSettings().providers[providerId];
  }

  /** Filter helper used by the BYOK tab (origin = "byok"), the agent
   *  setup flows (origin = "agent"), and the Plus sign-in handler
   *  (origin = "copilot-plus"). */
  listByOrigin(originKind: ProviderOrigin["kind"]): readonly Provider[] {
    return this.#byOrigin(getSettings().providers, originKind);
  }

  /** Used by the agent-setup idempotency check (one
   *  `(agentType, providerType)` row at most). */
  listByProviderType(providerType: ProviderType): readonly Provider[] {
    return this.#byType(getSettings().providers, providerType);
  }

  // -------------------------------------------------------------------------
  // Mutations — persist via `setSettings` updater form.
  // -------------------------------------------------------------------------

  /**
   * Mints a fresh `providerId` (UUID), stamps `addedAt`, persists.
   * Returns the new `providerId`. Does NOT store the API key — callers
   * invoke `setApiKey(...)` separately so the keychain pointer is owned
   * by this registry. `apiKeyKeychainId` is excluded from the input
   * shape so callers cannot create a row whose pointer references a
   * keychain entry this code path never wrote.
   */
  async add(input: Omit<Provider, "providerId" | "addedAt" | "apiKeyKeychainId">): Promise<string> {
    const providerId = uuidv4();
    const row: Provider = {
      ...input,
      providerId,
      addedAt: Date.now(),
      apiKeyKeychainId: null,
    };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: row },
    }));
    this.#emit();
    return providerId;
  }

  /** Partial update. The following fields are immutable through this
   *  entry point:
   *    - `providerId` / `addedAt`: identity & creation time.
   *    - `apiKeyKeychainId`: owned by `setApiKey` / `clearApiKey`; moving
   *       it via a generic patch would orphan keychain entries or
   *       repoint the row at a secret this registry never wrote.
   *    - `providerType`: the single dispatch field — changing it would
   *       leave the row's keychain entry and `extras` payload (whose
   *       shape is `providerType`-specific) pointing at a different
   *       adapter than the one that originally wrote them.
   *    - `origin`: the BYOK / agent / Plus discriminator — changing it
   *       silently moves the row between settings tabs and lifecycle
   *       owners.
   *  Create a new provider (and re-add models / re-enter the key) if any
   *  of these need to change. */
  async update(
    providerId: string,
    patch: Partial<
      Omit<Provider, "providerId" | "addedAt" | "apiKeyKeychainId" | "providerType" | "origin">
    >
  ): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) {
      throw new Error(
        `[modelManagement] ProviderRegistry.update: unknown providerId ${providerId}`
      );
    }
    // Defensive: strip immutable fields if any leaked in at runtime
    // (TypeScript's Omit covers callers using the typed shape).
    const safePatch = { ...patch } as Record<string, unknown>;
    delete safePatch.providerId;
    delete safePatch.addedAt;
    delete safePatch.apiKeyKeychainId;
    delete safePatch.providerType;
    delete safePatch.origin;
    if (Object.keys(safePatch).length === 0) return;
    const next: Provider = { ...existing, ...(safePatch as Partial<Provider>) };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: next },
    }));
    this.#emit();
  }

  /** Internal: writes `apiKeyKeychainId` on the row. Bypasses the public
   *  `update()` strip so only the keychain-bridge methods in this class
   *  can move the pointer. */
  #setApiKeyKeychainId(providerId: string, apiKeyKeychainId: string | null): void {
    // Read outside the updater so a row that's been concurrently
    // removed (or already carries the same pointer) skips the
    // setSettings call entirely — avoids broadcasting a fresh settings
    // reference to every subscriber for a no-op write.
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    if (existing.apiKeyKeychainId === apiKeyKeychainId) return;
    setSettings((cur) => {
      const current = cur.providers[providerId];
      if (!current) return {};
      return {
        providers: { ...cur.providers, [providerId]: { ...current, apiKeyKeychainId } },
      };
    });
  }

  /** Copy opaque provider API-key entries to readable IDs without removing their fallback. */
  migrateLegacyApiKeyIds(): void {
    for (const provider of Object.values(getSettings().providers)) {
      try {
        this.#migrateLegacyApiKeyId(provider);
      } catch (err) {
        logWarn(
          `[modelManagement] ProviderRegistry: failed to copy keychain entry for ${provider.displayName}`,
          err
        );
      }
    }
  }

  /**
   * Reconcile one provider credential with its readable persisted pointer.
   * A synced pointer may arrive on a device whose OS Keychain still contains
   * only the local legacy entry, so pointer shape alone cannot prove migration.
   */
  #migrateLegacyApiKeyId(provider: Provider): string | null {
    const currentId = provider.apiKeyKeychainId ?? null;
    if (!currentId) return null;

    const keychain = KeychainService.getInstance(this.#app);
    const legacyId = legacyProviderKeychainId(keychain.getVaultId(), provider.providerId);
    const hasLegacyPointer = currentId === legacyId;
    const readableId = hasLegacyPointer
      ? keychain.getProviderSecretId(
          provider.displayName.trim() || provider.providerType,
          provider.providerId
        )
      : currentId;
    const readableValue = keychain.getSecretById(readableId);
    if (!hasLegacyPointer && readableValue !== null) return readableId;

    const legacyValue = keychain.getSecretById(legacyId);
    if (legacyValue === null && readableValue === null) return currentId;

    try {
      // A local legacy value is authoritative while the readable target is
      // absent or the persisted pointer still names that legacy entry.
      if (legacyValue !== null && readableValue !== legacyValue) {
        keychain.setSecretById(readableId, legacyValue);
      }
      if (hasLegacyPointer) {
        this.#setApiKeyKeychainId(provider.providerId, readableId);
      }
    } catch (err) {
      logWarn(
        `[modelManagement] ProviderRegistry: failed to copy ${provider.displayName} credential to its readable keychain entry`,
        err
      );
      return legacyValue !== null ? legacyId : readableId;
    }
    return readableId;
  }

  /** Delete the active provider secret and any retained legacy compatibility copy. */
  #deleteApiKeySecrets(provider: Provider): void {
    const keychain = KeychainService.getInstance(this.#app);
    const legacyId = legacyProviderKeychainId(keychain.getVaultId(), provider.providerId);
    const ids = new Set([provider.apiKeyKeychainId, legacyId]);
    for (const id of ids) {
      if (!id) continue;
      try {
        keychain.deleteSecretById(id);
      } catch (err) {
        logError(`[modelManagement] ProviderRegistry: failed to clear keychain entry`, err);
      }
    }
  }

  /**
   * Removes the row from `settings.providers` and clears its keychain
   * entry. Cross-slice cascade (ConfiguredModels + BackendConfig refs)
   * is the coordinator's job — see class docstring.
   */
  async remove(providerId: string): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    this.#deleteApiKeySecrets(existing);
    setSettings((cur) => {
      const next = { ...cur.providers };
      delete next[providerId];
      return { providers: next };
    });
    this.#emit();
  }

  // -------------------------------------------------------------------------
  // Secrets — Obsidian keychain via `app.secretStorage` /
  // `KeychainService`.
  // -------------------------------------------------------------------------

  /** Reads the keychain entry referenced by the row's
   *  `apiKeyKeychainId`. Returns `null` for providers that don't take
   *  an API key (Ollama, LMStudio, agent-owned providers). */
  async getApiKey(providerId: string): Promise<string | null> {
    const row = getSettings().providers[providerId];
    if (!row || !row.apiKeyKeychainId) return null;
    const keychainId = this.#migrateLegacyApiKeyId(row);
    return keychainId ? KeychainService.getInstance(this.#app).getSecretById(keychainId) : null;
  }

  /** Generates a fresh `apiKeyKeychainId` if the provider doesn't
   *  yet have one; persists the row. Re-calling with a different key
   *  rotates in place (same keychain id, new value). */
  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row) {
      throw new Error(
        `[modelManagement] ProviderRegistry.setApiKey: unknown providerId ${providerId}`
      );
    }
    const keychain = KeychainService.getInstance(this.#app);
    const legacyId = legacyProviderKeychainId(keychain.getVaultId(), providerId);
    const isLegacyId = row.apiKeyKeychainId === legacyId;
    const keychainId =
      row.apiKeyKeychainId && !isLegacyId
        ? row.apiKeyKeychainId
        : keychain.getProviderSecretId(row.displayName.trim() || row.providerType, row.providerId);
    // New providers persist their pointer before the first write so a failed
    // write leaves a recoverable dangling pointer. Legacy providers update both
    // copies before their pointer moves, so failed settings persistence still
    // leaves the latest credential at the old durable location.
    if (!row.apiKeyKeychainId) {
      this.#setApiKeyKeychainId(providerId, keychainId);
    }
    if (isLegacyId) {
      keychain.setSecretById(legacyId, apiKey);
      keychain.setSecretById(keychainId, apiKey);
      this.#setApiKeyKeychainId(providerId, keychainId);
    } else {
      keychain.setSecretById(keychainId, apiKey);
      if (keychain.getSecretById(legacyId) !== null) {
        try {
          keychain.setSecretById(legacyId, apiKey);
        } catch (err) {
          logWarn(
            `[modelManagement] ProviderRegistry.setApiKey: failed to refresh legacy keychain fallback`,
            err
          );
        }
      }
    }
    this.#emit();
  }

  /** Drops the keychain entry and clears `apiKeyKeychainId` on the row. */
  async clearApiKey(providerId: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row) return;
    if (row.apiKeyKeychainId) {
      this.#deleteApiKeySecrets(row);
      this.#setApiKeyKeychainId(providerId, null);
      this.#emit();
    }
  }

  // -------------------------------------------------------------------------
  // Verification — dispatches to the adapter for `providerType`.
  // -------------------------------------------------------------------------

  /**
   * Issues an adapter-defined "ping". Returns the verification
   * result; does NOT persist it.
   */
  async verify(providerId: string): Promise<VerificationResult> {
    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(
        `[modelManagement] ProviderRegistry.verify: unknown providerId ${providerId}`
      );
    }
    const apiKey = await this.getApiKey(providerId);
    return this.#adapters.verifyCredentials(provider.providerType, {
      provider,
      apiKey,
      extras: provider.extras ?? {},
    });
  }
}
