import type { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import { providerNeedsResolvedApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { logError } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { getSettings, setSettings } from "@/settings/model";
import { frozenOr, sliceMemo, sliceMemoByKey } from "@/utils/sliceCache";

import type { Provider, ProviderOrigin } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { ProviderAdapterRegistry } from "./adapters/ProviderAdapterRegistry";

const EMPTY_LIST: readonly Provider[] = Object.freeze([]);

function providerKeychainId(vaultId: string, providerId: string): string {
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

  readonly #listeners = new Set<(providerId: string) => void>();

  constructor(app: App, adapters: ProviderAdapterRegistry) {
    this.#app = app;
    this.#adapters = adapters;
  }

  subscribe(listener: (providerId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(providerId: string): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(providerId);
      } catch (err) {
        logError("[modelManagement] ProviderRegistry listener threw", err);
      }
    }
  }

  list(): readonly Provider[] {
    return this.#list(getSettings().providers);
  }

  get(providerId: string): Provider | undefined {
    return getSettings().providers[providerId];
  }

  listByOrigin(originKind: ProviderOrigin["kind"]): readonly Provider[] {
    return this.#byOrigin(getSettings().providers, originKind);
  }

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
    this.#emit(providerId);
    return providerId;
  }

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
    const safePatch = { ...patch } as Record<string, unknown>;
    delete safePatch.providerId;
    delete safePatch.addedAt;
    delete safePatch.apiKeyKeychainId;
    delete safePatch.providerType;
    delete safePatch.origin;
    for (const key of Object.keys(safePatch)) {
      if (Object.is(existing[key as keyof Provider], safePatch[key])) {
        delete safePatch[key];
      }
    }
    if (Object.keys(safePatch).length === 0) return;
    // https://github.com/logancyang/obsidian-copilot-preview/issues/313:
    // enableCors selects only Quick Chat's renderer transport. Do not restart
    // OpenCode Agent for a CORS-only edit; the settings subscription already
    // rebuilds Quick Chat with the updated provider row.
    const affectsAgentProviderConfig = Object.keys(safePatch).some((key) => key !== "enableCors");
    const next: Provider = { ...existing, ...(safePatch as Partial<Provider>) };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: next },
    }));
    if (affectsAgentProviderConfig) this.#emit(providerId);
  }

  #setApiKeyKeychainId(providerId: string, apiKeyKeychainId: string | null): void {
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
    this.#emit(providerId);
  }

  async getApiKey(providerId: string): Promise<string | null> {
    const row = getSettings().providers[providerId];
    if (!row || !row.apiKeyKeychainId) return null;
    return KeychainService.getInstance(this.#app).getSecretById(row.apiKeyKeychainId);
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row) {
      throw new Error(
        `[modelManagement] ProviderRegistry.setApiKey: unknown providerId ${providerId}`
      );
    }
    const keychain = KeychainService.getInstance(this.#app);
    const keychainId =
      row.apiKeyKeychainId ?? providerKeychainId(keychain.getVaultId(), providerId);
    // Re-registering with the key already stored is not a change, and emitting
    // one restarts every backend that bakes provider config into its spawn
    // (Plus reconciliation replays the license key on every sign-in and load).
    // Compare the stored secret, not the pointer: a same-id rotation is what
    // the pointer cannot see, and a dangling pointer reads back null, so it
    // still writes and repairs itself.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/472
    if (row.apiKeyKeychainId === keychainId && keychain.getSecretById(keychainId) === apiKey) {
      return;
    }
    if (row.apiKeyKeychainId !== keychainId) {
      this.#setApiKeyKeychainId(providerId, keychainId);
    }
    keychain.setSecretById(keychainId, apiKey);
    this.#emit(providerId);
  }

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
      this.#emit(providerId);
    }
  }

  async verify(providerId: string): Promise<VerificationResult> {
    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(
        `[modelManagement] ProviderRegistry.verify: unknown providerId ${providerId}`
      );
    }
    const apiKey = await this.getApiKey(providerId);
    // https://github.com/logancyang/obsidian-copilot/issues/3147:
    // A public models endpoint must not mask a missing stored credential.
    if (providerNeedsResolvedApiKey(provider) && !apiKey?.trim()) {
      return {
        ok: false,
        code: "missing_api_key",
        message: "API key is missing. Configure this provider to enter it again.",
        checkedAt: Date.now(),
      };
    }
    return this.#adapters.verifyCredentials(provider.providerType, {
      provider,
      apiKey,
      extras: provider.extras ?? {},
    });
  }
}
