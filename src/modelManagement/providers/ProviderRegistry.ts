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
import {
  allocateUniqueProviderDisplayName,
  buildProviderKeychainId,
  providerKeychainStableToken,
} from "./providerIdentity";

// Frozen empty shared across all filtered views so consumers see a
// stable reference even when two distinct filters both yield zero rows.
const EMPTY_LIST: readonly Provider[] = Object.freeze([]);

/** Observable outcome of one device-local provider credential reconciliation pass. */
export interface ProviderCredentialReconciliationResult {
  migrated: number;
  repointed: number;
  deleted: number;
  conflicts: number;
  failures: string[];
  unavailable: boolean;
}

function addCandidate(candidates: string[], candidate: string | null | undefined): void {
  if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
}

function hasSecretValue(value: string | null): value is string {
  return value !== null && value !== "";
}

/** Manages persisted provider identities and their vault-scoped credentials. */
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
    const displayName = allocateUniqueProviderDisplayName(
      input.displayName,
      Object.values(getSettings().providers).map((provider) => provider.displayName)
    );
    const row: Provider = {
      ...input,
      displayName,
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
    if ("displayName" in safePatch) {
      if (typeof safePatch.displayName !== "string") {
        throw new Error("Provider name must be a string");
      }
      safePatch.displayName = allocateUniqueProviderDisplayName(
        safePatch.displayName,
        Object.values(getSettings().providers)
          .filter((provider) => provider.providerId !== providerId)
          .map((provider) => provider.displayName)
      );
    }
    if (Object.keys(safePatch).length === 0) return;
    const next: Provider = { ...existing, ...(safePatch as Partial<Provider>) };

    if (existing.apiKeyKeychainId) {
      const keychain = KeychainService.getInstance(this.#app);
      const nextKeychainId = buildProviderKeychainId(
        keychain.getVaultId(),
        next.displayName,
        providerId
      );
      if (nextKeychainId !== existing.apiKeyKeychainId) {
        const apiKey = keychain.getSecretById(existing.apiKeyKeychainId);
        if (apiKey !== null) {
          keychain.setSecretById(nextKeychainId, apiKey);
        }
        setSettings((cur) => ({
          providers: {
            ...cur.providers,
            [providerId]: { ...next, apiKeyKeychainId: nextKeychainId },
          },
        }));
        try {
          keychain.deleteSecretById(existing.apiKeyKeychainId);
        } catch (err) {
          logError(`[modelManagement] ProviderRegistry.update: failed to clear old keychain`, err);
        }
        this.#emit();
        return;
      }
    }

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

  /**
   * Removes the row from `settings.providers` and clears its keychain
   * entry. Cross-slice cascade (ConfiguredModels + BackendConfig refs)
   * is the coordinator's job — see class docstring.
   */
  async remove(providerId: string): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    if (existing.apiKeyKeychainId) {
      try {
        KeychainService.getInstance(this.#app).deleteSecretById(existing.apiKeyKeychainId);
      } catch (err) {
        logError(`[modelManagement] ProviderRegistry.remove: failed to clear keychain`, err);
      }
    }
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
    return KeychainService.getInstance(this.#app).getSecretById(row.apiKeyKeychainId);
  }

  /**
   * Reconcile every provider pointer and device-local credential with its current readable ID.
   * Runs on every startup because settings sync can deliver a rename before this device has
   * moved the corresponding local keychain entry.
   */
  async reconcileCredentials(): Promise<ProviderCredentialReconciliationResult> {
    const result: ProviderCredentialReconciliationResult = {
      migrated: 0,
      repointed: 0,
      deleted: 0,
      conflicts: 0,
      failures: [],
      unavailable: false,
    };
    const keychain = KeychainService.getInstance(this.#app);
    if (!keychain.isAvailable()) {
      result.unavailable = true;
      return result;
    }

    let listedIds: string[] = [];
    let enumerationComplete = true;
    try {
      listedIds = keychain.listSecretIds();
    } catch (err) {
      enumerationComplete = false;
      const failure = "failed to list SecretStorage IDs";
      result.failures.push(failure);
      logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
    }
    const listedIdSet = new Set(listedIds);
    let changed = false;

    for (const row of [...Object.values(getSettings().providers)].sort((a, b) =>
      a.providerId.localeCompare(b.providerId)
    )) {
      const vaultId = keychain.getVaultId();
      let expectedId: string;
      try {
        expectedId = buildProviderKeychainId(vaultId, row.displayName, row.providerId);
      } catch (err) {
        const failure = `provider ${row.providerId}: invalid readable keychain identity`;
        result.failures.push(failure);
        logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
        continue;
      }

      const legacyId = `copilot-v${vaultId}-provider-${row.providerId}`;
      const providerPrefix = `copilot-v${vaultId}-provider-`;
      const stableSuffix = `-${providerKeychainStableToken(row.providerId)}`;
      const stableCandidates = enumerationComplete
        ? listedIds
            .filter((id) => id.startsWith(providerPrefix) && id.endsWith(stableSuffix))
            .sort()
        : [];
      const candidateIds: string[] = [];
      addCandidate(candidateIds, row.apiKeyKeychainId);
      addCandidate(candidateIds, expectedId);
      if (enumerationComplete) addCandidate(candidateIds, legacyId);
      for (const candidate of stableCandidates) addCandidate(candidateIds, candidate);

      const values = new Map<string, string | null>();
      let readFailed = false;
      for (const candidateId of candidateIds) {
        try {
          values.set(candidateId, keychain.getSecretById(candidateId));
        } catch (err) {
          const failure = `provider ${row.providerId}: failed to read ${candidateId}`;
          result.failures.push(failure);
          logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
          readFailed = true;
          break;
        }
      }
      if (readFailed) continue;

      const pointerId = row.apiKeyKeychainId;
      const destinationValue = values.get(expectedId) ?? null;
      const populated = candidateIds.filter((id) => hasSecretValue(values.get(id) ?? null));

      // Undefined predates the explicit pointer contract, so it permits inference
      // only from a complete, unambiguous view of this device's keychain.
      if (pointerId === undefined) {
        if (!enumerationComplete) continue;
        if (destinationValue === "") {
          if (populated.length > 0) {
            result.conflicts += 1;
            logWarn(
              `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has a canonical tombstone; preserving older credentials`
            );
          }
          continue;
        }

        const inferredValues = new Set(populated.map((id) => values.get(id)!));
        if (inferredValues.size > 1) {
          result.conflicts += 1;
          logWarn(
            `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has ambiguous legacy credentials; preserving every candidate`
          );
          continue;
        }
        const inferredSourceId = populated[0];
        if (!inferredSourceId) continue;
        const inferredValue = values.get(inferredSourceId)!;

        if (destinationValue === null) {
          try {
            keychain.setSecretById(expectedId, inferredValue);
            result.migrated += 1;
          } catch (err) {
            const failure = `provider ${row.providerId}: failed to write ${expectedId}`;
            result.failures.push(failure);
            logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
            continue;
          }
        }

        this.#setApiKeyKeychainId(row.providerId, expectedId);
        result.repointed += 1;
        changed = true;
        for (const candidateId of candidateIds) {
          if (candidateId === expectedId) continue;
          const value = values.get(candidateId) ?? null;
          const mayDelete =
            value === inferredValue || (!hasSecretValue(value) && listedIdSet.has(candidateId));
          if (!mayDelete) continue;
          try {
            keychain.deleteSecretById(candidateId);
            result.deleted += 1;
          } catch (err) {
            const failure = `provider ${row.providerId}: failed to delete ${candidateId}`;
            result.failures.push(failure);
            logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
          }
        }
        continue;
      }

      // A null pointer is synced clear intent. Device-local leftovers must never
      // reactivate a provider whose settings explicitly say it has no credential.
      if (pointerId === null) {
        const orphanValues = new Set(populated.map((id) => values.get(id)!));
        if (orphanValues.size > 1) {
          result.conflicts += 1;
          logWarn(
            `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has ambiguous orphan credentials; preserving every candidate`
          );
          continue;
        }
        if (enumerationComplete) {
          for (const candidateId of candidateIds) {
            if (values.get(candidateId) !== "" || !listedIdSet.has(candidateId)) continue;
            try {
              keychain.deleteSecretById(candidateId);
              result.deleted += 1;
            } catch (err) {
              const failure = `provider ${row.providerId}: failed to delete ${candidateId}`;
              result.failures.push(failure);
              logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
            }
          }
        }
        continue;
      }

      const pointerValue = values.get(pointerId) ?? null;
      if (pointerValue === "") {
        if (hasSecretValue(destinationValue)) {
          result.conflicts += 1;
          logWarn(
            `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has a pointed tombstone and populated destination; preserving both`
          );
          continue;
        }
        if (populated.length > 0) {
          result.conflicts += 1;
          logWarn(
            `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has a pointed tombstone; preserving older credentials`
          );
        }
        if (destinationValue === null) {
          try {
            keychain.setSecretById(expectedId, "");
            result.migrated += 1;
          } catch (err) {
            const failure = `provider ${row.providerId}: failed to write ${expectedId}`;
            result.failures.push(failure);
            logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
            continue;
          }
        }
        if (pointerId !== expectedId) {
          this.#setApiKeyKeychainId(row.providerId, expectedId);
          result.repointed += 1;
          changed = true;
        }
        if (enumerationComplete) {
          for (const candidateId of candidateIds) {
            if (
              candidateId === expectedId ||
              values.get(candidateId) !== "" ||
              !listedIdSet.has(candidateId)
            ) {
              continue;
            }
            try {
              keychain.deleteSecretById(candidateId);
              result.deleted += 1;
            } catch (err) {
              const failure = `provider ${row.providerId}: failed to delete ${candidateId}`;
              result.failures.push(failure);
              logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
            }
          }
        }
        continue;
      }

      // A tombstone at the canonical destination is stronger than any older
      // device-local value: it prevents an alias from resurrecting a cleared key.
      if (destinationValue === "") {
        const oldPopulated = populated.filter((id) => id !== expectedId);
        if (oldPopulated.length > 0) {
          result.conflicts += 1;
          logWarn(
            `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has a canonical tombstone; preserving older credentials`
          );
        }
        if (pointerId !== expectedId) {
          this.#setApiKeyKeychainId(row.providerId, expectedId);
          result.repointed += 1;
          changed = true;
        }
        if (enumerationComplete) {
          for (const candidateId of candidateIds) {
            if (
              candidateId === expectedId ||
              values.get(candidateId) !== "" ||
              !listedIdSet.has(candidateId)
            ) {
              continue;
            }
            try {
              keychain.deleteSecretById(candidateId);
              result.deleted += 1;
            } catch (err) {
              const failure = `provider ${row.providerId}: failed to delete ${candidateId}`;
              result.failures.push(failure);
              logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
            }
          }
        }
        continue;
      }

      let sourceId: string | undefined;
      if (hasSecretValue(pointerValue)) sourceId = pointerId;
      else if (hasSecretValue(destinationValue)) sourceId = expectedId;

      if (!sourceId && enumerationComplete) {
        const unpointedIds: string[] = [];
        addCandidate(unpointedIds, legacyId);
        for (const candidateId of stableCandidates) addCandidate(unpointedIds, candidateId);
        const unpointedValues = new Map<string, string>();
        for (const candidateId of unpointedIds) {
          const value = values.get(candidateId) ?? null;
          if (hasSecretValue(value) && !unpointedValues.has(value)) {
            unpointedValues.set(value, candidateId);
          }
        }
        if (unpointedValues.size > 1) {
          result.conflicts += 1;
          logWarn(
            `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has ambiguous unpointed credentials; preserving every candidate`
          );
          continue;
        }
        sourceId = unpointedValues.values().next().value;
      }

      const sourceValue = sourceId ? (values.get(sourceId) ?? null) : null;
      if (
        hasSecretValue(destinationValue) &&
        hasSecretValue(sourceValue) &&
        sourceId !== expectedId &&
        sourceValue !== destinationValue
      ) {
        result.conflicts += 1;
        logWarn(
          `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has a differing destination; preserving both credentials`
        );
        continue;
      }

      const differingValues = new Set(populated.map((id) => values.get(id)!));
      if (differingValues.size > 1) {
        result.conflicts += 1;
        logWarn(
          `[modelManagement] ProviderRegistry.reconcileCredentials: provider ${row.providerId} has multiple credential candidates; preserving non-selected values`
        );
      }

      if (destinationValue === null && hasSecretValue(sourceValue)) {
        try {
          keychain.setSecretById(expectedId, sourceValue);
          result.migrated += 1;
        } catch (err) {
          const failure = `provider ${row.providerId}: failed to write ${expectedId}`;
          result.failures.push(failure);
          logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
          continue;
        }
      }

      if (pointerId !== expectedId) {
        this.#setApiKeyKeychainId(row.providerId, expectedId);
        result.repointed += 1;
        changed = true;
      }

      if (!enumerationComplete) continue;
      for (const candidateId of candidateIds) {
        if (candidateId === expectedId) continue;
        const value = values.get(candidateId) ?? null;
        const mayDelete =
          (hasSecretValue(sourceValue) && value === sourceValue) ||
          (!hasSecretValue(value) && listedIdSet.has(candidateId));
        if (!mayDelete) continue;
        try {
          keychain.deleteSecretById(candidateId);
          result.deleted += 1;
        } catch (err) {
          const failure = `provider ${row.providerId}: failed to delete ${candidateId}`;
          result.failures.push(failure);
          logError(`[modelManagement] ProviderRegistry.reconcileCredentials: ${failure}`, err);
        }
      }
    }

    if (changed || result.migrated > 0) this.#emit();
    return result;
  }

  /** Stores the API key under the provider's readable identity and persists its pointer. */
  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row) {
      throw new Error(
        `[modelManagement] ProviderRegistry.setApiKey: unknown providerId ${providerId}`
      );
    }
    const keychain = KeychainService.getInstance(this.#app);
    const keychainId = buildProviderKeychainId(keychain.getVaultId(), row.displayName, providerId);
    // The destination must be durable before the settings pointer moves;
    // otherwise a rejected keychain write would make the existing secret unreachable.
    keychain.setSecretById(keychainId, apiKey);
    if (row.apiKeyKeychainId !== keychainId) {
      this.#setApiKeyKeychainId(providerId, keychainId);
      if (row.apiKeyKeychainId) {
        try {
          keychain.deleteSecretById(row.apiKeyKeychainId);
        } catch (err) {
          logError(
            `[modelManagement] ProviderRegistry.setApiKey: failed to clear old keychain`,
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
      try {
        KeychainService.getInstance(this.#app).deleteSecretById(row.apiKeyKeychainId);
      } catch (err) {
        logError(`[modelManagement] ProviderRegistry.clearApiKey: failed to delete keychain`, err);
      }
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
