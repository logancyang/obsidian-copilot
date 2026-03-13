# Keychain Migration: Obsidian SecretStorage for API Keys

## Context

The plugin currently stores ~24 sensitive fields (API keys, license keys, tokens) in `data.json` via Obsidian's `plugin.saveData()`. An optional encryption layer (`encryptionService.ts`) uses Electron SafeStorage or a **hardcoded Web Crypto key** as fallback. This has two problems:

1. **Weak security**: The Web Crypto fallback uses a hardcoded key visible in source code — security theater
2. **Cross-platform failures**: `enc_desk_` (Electron SafeStorage) values can't decrypt on mobile. `enc_web_` uses a different codepath. Users moving between desktop/mobile or syncing vaults hit decryption failures regularly.

Obsidian 1.11.4+ introduced `SecretStorage` — a native API backed by OS-level secure storage (macOS Keychain, Windows Credential Manager, Linux libsecret, iOS Keychain Services, Android Keystore).

**Issue**: [#2162](https://github.com/logancyang/obsidian-copilot/issues/2162)

## Obsidian SecretStorage API (≥1.11.4)

```typescript
// Access via app instance (property on App, @since 1.11.4)
app.secretStorage: SecretStorage;

// Methods (all synchronous)
secretStorage.setSecret(id: string, secret: string): void;
secretStorage.getSecret(id: string): string | null;
secretStorage.listSecrets(): string[];
```

**Key constraints**:

- Secret IDs must be lowercase alphanumeric with optional dashes
- Available on both desktop and mobile
- Device-local — does NOT sync across devices (OS keychains are inherently per-device)

## Architecture: Keychain Only

**One mode. No toggles. No dual-write.**

All secrets live in the OS keychain. `data.json` never contains secrets after migration.

```
┌─────────────────────────────────────────────────────┐
│                    On Write (save key)               │
│                                                      │
│  1. Write to keychain                                │
│  2. data.json field stays empty (not a secret store) │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                    On Read (get key)                  │
│                                                      │
│  1. Read from keychain                               │
│  2. Return value (or "" if not found)                │
└─────────────────────────────────────────────────────┘
```

**Trade-off**: Keys don't sync across devices. Users enter keys once per device. This is the same model used by 1Password, SSH keys, and most credential managers.

### Upgrade path (existing users)

On first load after upgrade:

1. Read all sensitive fields from data.json (decrypt `enc_` values if needed)
2. Write each non-empty value to keychain
3. Clear all sensitive fields in data.json to `""`
4. Save cleaned data.json
5. Show one-time notice: _"Your API keys have been moved to secure storage. You may need to re-enter them on other devices."_

After migration, `encryptionService.ts` is never called again.

## Sensitive Fields

### Global Provider Keys (in `CopilotSettings`)

| Settings Field        | Keychain ID                      |
| --------------------- | -------------------------------- |
| `plusLicenseKey`      | `copilot-plus-license-key`       |
| `openAIApiKey`        | `copilot-openai-api-key`         |
| `openAIOrgId`         | `copilot-openai-org-id`          |
| `huggingfaceApiKey`   | `copilot-huggingface-api-key`    |
| `cohereApiKey`        | `copilot-cohere-api-key`         |
| `anthropicApiKey`     | `copilot-anthropic-api-key`      |
| `azureOpenAIApiKey`   | `copilot-azure-openai-api-key`   |
| `googleApiKey`        | `copilot-google-api-key`         |
| `openRouterAiApiKey`  | `copilot-openrouter-ai-api-key`  |
| `xaiApiKey`           | `copilot-xai-api-key`            |
| `mistralApiKey`       | `copilot-mistral-api-key`        |
| `deepseekApiKey`      | `copilot-deepseek-api-key`       |
| `amazonBedrockApiKey` | `copilot-amazon-bedrock-api-key` |
| `siliconflowApiKey`   | `copilot-siliconflow-api-key`    |
| `groqApiKey`          | `copilot-groq-api-key`           |
| `selfHostApiKey`      | `copilot-self-host-api-key`      |
| `firecrawlApiKey`     | `copilot-firecrawl-api-key`      |
| `perplexityApiKey`    | `copilot-perplexity-api-key`     |
| `supadataApiKey`      | `copilot-supadata-api-key`       |

### GitHub Copilot Tokens (runtime-refreshed)

| Settings Field             | Keychain ID                           |
| -------------------------- | ------------------------------------- |
| `githubCopilotAccessToken` | `copilot-github-copilot-access-token` |
| `githubCopilotToken`       | `copilot-github-copilot-token`        |

These are runtime OAuth tokens with auth/refresh/reset lifecycle. Expiry metadata (`githubCopilotTokenExpiresAt`) stays in data.json — it's a numeric timestamp, not a secret.

### Per-Model Keys (in `activeModels[].apiKey` and `activeEmbeddingModels[].apiKey`)

Keychain ID derived from model identity:

- Chat models: `copilot-chat-{provider}-{normalized-name}`
- Embedding models: `copilot-embed-{provider}-{normalized-name}`

**Normalization**: lowercase, non-alphanumeric → dashes, collapse consecutive dashes, truncate to 64 chars (with hash suffix if truncated).

## Implementation Plan

### Step 1: Bump Dependencies & Fix Type Errors

- Update `package.json`: `"obsidian": "1.12.2"` (devDependency)
- Update `manifest.json`: `"minAppVersion": "1.11.4"`
- Update `versions.json`: add entry for the new release version → `"1.11.4"`
- Run `npm install`
- Fix any new type errors from the API bump

### Step 2: Fix MarkdownRenderer Breaking Change

`MarkdownRenderer.renderMarkdown()` is deprecated → `MarkdownRenderer.render()` adds `app: App` as first parameter.

```typescript
// OLD:
MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, component);
// NEW:
MarkdownRenderer.render(app, markdown, el, sourcePath, component);
```

| File                                                        | Fix                                      |
| ----------------------------------------------------------- | ---------------------------------------- |
| `src/components/chat-components/ChatSingleMessage.tsx`      | Add `app` as first arg                   |
| `src/components/quick-ask/QuickAskMessage.tsx`              | Add `plugin.app` as first arg            |
| `src/components/chat-components/ChatSingleMessage.test.tsx` | Update mock: `renderMarkdown` → `render` |

**Gate**: `npm run build && npm run test` must pass before proceeding.

### Step 3: Create `src/keychainService.ts`

Simple singleton — no modes, no conditionals:

```typescript
export class KeychainService {
  private secretStorage: SecretStorage;

  constructor(app: App) {
    this.secretStorage = app.secretStorage;
  }

  /** Write a provider key to keychain */
  setProviderKey(settingsKey: string, value: string): void;

  /** Read a provider key from keychain */
  getProviderKey(settingsKey: string): string | null;

  /** Check if a provider key exists in keychain */
  hasProviderKey(settingsKey: string): boolean;

  /** Clear a provider key from keychain */
  clearProviderKey(settingsKey: string): void;

  /** Write a per-model key to keychain */
  setModelKey(type: "chat" | "embed", name: string, provider: string, value: string): void;

  /** Read a per-model key from keychain */
  getModelKey(type: "chat" | "embed", name: string, provider: string): string | null;

  /** Migrate: move all secrets from data.json → keychain, clear data.json */
  migrateFromSettings(settings: CopilotSettings): number; // returns count migrated

  /** List all copilot secrets in keychain */
  listKeys(): string[];
}

// Singleton
export function initKeychain(app: App): void;
export function getKeychain(): KeychainService;
```

**ID normalization**: `camelCase` → `kebab-case`, prefixed with `copilot-`.
Pure helper: `settingsKeyToKeychainId(key: string): string`.

### Step 4: Migration on Load (in `main.ts` `onload`)

```
1. Load settings from data.json (existing flow)
2. Initialize KeychainService
3. One-time migration:
   a. For each sensitive field in settings:
      - If encrypted (enc_ prefix): decrypt using getDecryptedKey()
      - If non-empty: write to keychain, clear field to ""
   b. For each model in activeModels/activeEmbeddingModels:
      - Same: decrypt if needed, write to keychain, clear apiKey to ""
   c. Set enableEncryption to false
   d. Save cleaned settings to data.json
   e. Show notice: "Your API keys have been moved to secure storage..."
4. Continue normal plugin initialization
```

**Idempotent**: Migration only acts on non-empty fields. Once data.json fields are cleared, subsequent loads are no-ops.

### Step 5: Update Key Retrieval

Replace all `getDecryptedKey` calls with direct keychain reads. Everything becomes **synchronous**.

**`src/utils/modelUtils.ts` — `getApiKeyForProvider()`**:

```typescript
export function getApiKeyForProvider(provider: SettingKeyProviders, model?: CustomModel): string {
  const keychain = getKeychain();
  if (model?.name && model?.provider) {
    const k = keychain.getModelKey("chat", model.name, model.provider);
    if (k) return k;
  }
  const settingsField = ProviderSettingsKeyMap[provider];
  return keychain.getProviderKey(settingsField) ?? "";
}
```

**`src/LLMProviders/chatModelManager.ts`** — Replace 17 `getDecryptedKey` calls:

```typescript
// Before (async):
const apiKey = await getDecryptedKey(customModel.apiKey || settings.openAIApiKey);

// After (sync):
const apiKey = resolveApiKey(customModel, "openAIApiKey");

function resolveApiKey(model: CustomModel | undefined, settingsField: string): string {
  const keychain = getKeychain();
  if (model?.name && model?.provider) {
    const k = keychain.getModelKey("chat", model.name, model.provider);
    if (k) return k;
  }
  return keychain.getProviderKey(settingsField) ?? "";
}
```

### Step 6: Update Settings UI

**API key inputs** — write to keychain instead of settings:

- `ApiKeyDialog.tsx`: on save → `keychain.setProviderKey()`, on load → `keychain.getProviderKey()`
- `ModelEditDialog.tsx`, `ModelAddDialog.tsx`: per-model keys via `setModelKey()`
- `PlusSettings.tsx`: read `plusLicenseKey` via keychain
- `CopilotPlusSettings.tsx`: read `firecrawlApiKey` etc. via keychain

**Remove "Enable encryption" toggle** from UI. Field stays in settings model for backward compat (hardcoded `false`).

### Step 7: Update All Secret Consumer Sites

| File                                    | What it reads                       | Change                                        |
| --------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `src/plusUtils.ts`                      | `settings.plusLicenseKey`           | → `keychain.getProviderKey("plusLicenseKey")` |
| `src/miyo/MiyoClient.ts`                | `settings.selfHostApiKey`           | → `keychain.getProviderKey("selfHostApiKey")` |
| `src/mentions/Mention.ts`               | `settings.supadataApiKey`           | → `keychain.hasProviderKey("supadataApiKey")` |
| `src/tools/YoutubeTools.ts`             | `settings.supadataApiKey`           | → `keychain.hasProviderKey("supadataApiKey")` |
| `src/utils.ts`                          | Multiple keys in `checkModelApiKey` | → keychain reads                              |
| `src/utils/curlCommand.ts`              | `getDecryptedKey`                   | → `keychain.getProviderKey()`                 |
| `src/components/ui/password-input.tsx`  | `getDecryptedKey`                   | → `keychain.getProviderKey()`                 |
| `src/settings/v2/utils/modelActions.ts` | `getDecryptedKey`                   | → keychain read                               |
| `src/LLMProviders/embeddingManager.ts`  | 10 `getDecryptedKey` calls          | → `resolveApiKey` (sync)                      |
| `src/LLMProviders/brevilabsClient.ts`   | 3 `getDecryptedKey` calls           | → keychain reads                              |
| `src/LLMProviders/selfHostServices.ts`  | 3 `getDecryptedKey` calls           | → keychain reads                              |

### Step 8: GitHub Copilot Token Integration

Update `src/LLMProviders/githubCopilot/GitHubCopilotProvider.ts`:

| Operation                      | Current                                          | New                                                                   |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------- |
| Store access token (line 338)  | `setSettings({ githubCopilotAccessToken })`      | `keychain.setProviderKey("githubCopilotAccessToken", ...)`            |
| Store copilot token (line 441) | `setSettings({ githubCopilotToken, ...expiry })` | Token → `keychain.setProviderKey()`; expiry → `setSettings()`         |
| Reset auth (line 782)          | `setSettings({ ...all empty })`                  | `keychain.clearProviderKey(...)` for tokens; `setSettings` for expiry |
| Read token (line 465)          | `getDecryptedKey(settings.githubCopilotToken)`   | `keychain.getProviderKey("githubCopilotToken")`                       |
| Check auth (line 162)          | `settings.githubCopilotAccessToken`              | `keychain.hasProviderKey("githubCopilotAccessToken")`                 |

### Step 9: Simplify Settings Save & Deprecate Encryption

In `main.ts` settings save:

```typescript
// Before:
if (next.enableEncryption) {
  await this.saveData(await encryptAllKeys(next));
} else {
  await this.saveData(next);
}

// After:
await this.saveData(next);
```

Deprecate `encryptionService.ts`:

- Keep file for one-time legacy decryption in Step 4
- Mark all exports `@deprecated`
- Remove all imports of `getDecryptedKey`/`getEncryptedKey`/`encryptAllKeys` except migration path
- Delete or convert `encryptionService.test.ts`

## Files to Modify

### New

| File                          | Purpose                   |
| ----------------------------- | ------------------------- |
| `src/keychainService.ts`      | KeychainService singleton |
| `src/keychainService.test.ts` | Unit tests                |

### Core

| File                    | Change                                               |
| ----------------------- | ---------------------------------------------------- |
| `package.json`          | Bump obsidian to 1.12.2                              |
| `manifest.json`         | minAppVersion → 1.11.4                               |
| `versions.json`         | Add new version mapping                              |
| `src/main.ts`           | Init keychain, migration on load, simplify save      |
| `src/settings/model.ts` | Keep `enableEncryption` for compat (default `false`) |

### MarkdownRenderer Fix

| File                                                        | Change                                         |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `src/components/chat-components/ChatSingleMessage.tsx`      | `renderMarkdown()` → `render(app, ...)`        |
| `src/components/quick-ask/QuickAskMessage.tsx`              | `renderMarkdown()` → `render(plugin.app, ...)` |
| `src/components/chat-components/ChatSingleMessage.test.tsx` | Update mock                                    |

### Secret Consumers (remove `getDecryptedKey`, use keychain)

| File                                                      | Calls                 |
| --------------------------------------------------------- | --------------------- |
| `src/LLMProviders/chatModelManager.ts`                    | 17                    |
| `src/LLMProviders/embeddingManager.ts`                    | 10                    |
| `src/LLMProviders/brevilabsClient.ts`                     | 3                     |
| `src/LLMProviders/selfHostServices.ts`                    | 3                     |
| `src/LLMProviders/githubCopilot/GitHubCopilotProvider.ts` | 2 reads + 3 writes    |
| `src/utils/curlCommand.ts`                                | 1                     |
| `src/components/ui/password-input.tsx`                    | 1                     |
| `src/settings/v2/utils/modelActions.ts`                   | 1                     |
| `src/plusUtils.ts`                                        | direct settings read  |
| `src/miyo/MiyoClient.ts`                                  | direct settings read  |
| `src/mentions/Mention.ts`                                 | direct settings read  |
| `src/tools/YoutubeTools.ts`                               | direct settings read  |
| `src/utils.ts`                                            | direct settings reads |

### Settings UI

| File                                                 | Change                      |
| ---------------------------------------------------- | --------------------------- |
| `src/settings/v2/components/ApiKeyDialog.tsx`        | Write/read via keychain     |
| `src/settings/v2/components/ModelEditDialog.tsx`     | Per-model keys via keychain |
| `src/settings/v2/components/ModelAddDialog.tsx`      | Per-model keys via keychain |
| `src/settings/v2/components/PlusSettings.tsx`        | Read via keychain           |
| `src/settings/v2/components/CopilotPlusSettings.tsx` | Read via keychain           |

### Deprecated

| File                            | Status                             |
| ------------------------------- | ---------------------------------- |
| `src/encryptionService.ts`      | Deprecated; legacy decryption only |
| `src/encryptionService.test.ts` | Delete or convert                  |

## Migration Safety

- **One-way**: Once keys move to keychain, data.json fields are empty. No rollback needed — keys are in keychain.
- **Idempotent**: Only migrates non-empty fields. Safe to run multiple times.
- **Non-breaking**: Existing users' keys are silently migrated on first load. Everything keeps working.
- **One-time notice**: Users are informed about the change and that other devices may need re-entry.
- **Legacy decryption**: `enc_desk_`, `enc_web_`, `enc_` values are all handled in one pass.
- **No encryption going forward**: `encryptionService` is deprecated. No more cross-platform decryption failures.

## Verification Checklist

### Build & Tests

- [ ] `npm install` succeeds with new obsidian version
- [ ] `npm run build` passes
- [ ] `npm run test` passes (including keychainService tests)
- [ ] No remaining imports of `getDecryptedKey` outside migration path

### Fresh Install

- [ ] Enter API key → stored in keychain, data.json field is empty
- [ ] Key resolves correctly when creating LLM chat
- [ ] All key reads are synchronous

### Upgrade — Plaintext Keys

- [ ] Keys migrate from data.json → keychain on first load
- [ ] data.json sensitive fields are now empty strings
- [ ] One-time notice shown
- [ ] All providers still work

### Upgrade — Encrypted Keys

- [ ] `enc_desk_`/`enc_web_`/`enc_` values decrypt → migrate to keychain
- [ ] `enableEncryption` set to `false`
- [ ] data.json now has empty strings (no encrypted or plaintext secrets)
- [ ] All providers still work

### Multi-Device

- [ ] Device B: data.json syncs with empty key fields — no crash
- [ ] Device B: user re-enters key → stored in local keychain → works

### GitHub Copilot Tokens

- [ ] Auth stores token in keychain
- [ ] Token refresh writes new token to keychain
- [ ] Logout clears tokens from keychain
- [ ] Expiry timestamp stays in data.json

### Edge Cases

- [ ] Per-model keys with long/special-char names normalize correctly
- [ ] Chat + embedding model with same name/provider → no ID collision
- [ ] Markdown rendering works after API bump (chat messages, Quick Ask, streaming)

## References

- [Obsidian 1.11.0 Changelog](https://obsidian.md/changelog/2025-12-10-desktop-v1.11.0/)
- [Obsidian 1.11.4 Changelog](https://obsidian.md/changelog/2026-01-07-desktop-v1.11.4/)
- [Obsidian Developer Docs: Secret Storage](https://docs.obsidian.md/plugins/guides/secret-storage)
- [Obsidian API Types (GitHub)](https://github.com/obsidianmd/obsidian-api)
