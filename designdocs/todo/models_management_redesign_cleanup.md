# Model Management Redesign — Cleanup TODOs

Deferred work from the model-settings redesign (the new BYOK tab replacing
the old "Model" tab). These are intentional follow-ups, not bugs to fix in
the redesign PR.

## Settings that lost their UI

The old `ModelSettings.tsx` hosted two sliders that no longer have a home.
Both values are still read at runtime, so they're frozen at their persisted
/ default values until we either re-home or retire them.

- **`contextTurns`** ("Conversation turns in context") — consumed by
  `memoryManager`. Planned to be retired; no replacement UI.
- **`autoCompactThreshold`** ("Auto-compact threshold") — consumed by
  `ContextManager`. Planned to be retired; no replacement UI.

Decision: we intend to stop supporting both soon, so we are deliberately
not re-adding UI for them. When support is dropped, remove the settings
fields and their runtime consumers.

## Chat model picker still reads legacy `activeModels`

The new BYOK panel writes to the `Provider` / `ConfiguredModel` /
`BackendConfig` registries, but the chat-model picker in `BasicSettings`
(and `chatModelManager`) still reads `settings.activeModels`. This is fine
for now — the picker will be migrated to the new registry in a later PR.
Until then, providers/models added via the BYOK tab won't appear in the
default-chat-model dropdown.

> **Status (still open):** This item is about the **chat-mode** picker only.
> The **agent-backend** curation (opencode / claude-code / codex) has been
> fully migrated off the legacy `activeModels` + `modelEnabledOverrides` path
> to the new `backends.<agentType>.enabledModels` registry. The chat-mode `BasicSettings`
> / `chatModelManager` migration remains future work and is unchanged by that
> effort.

## Legacy → new migration (incl. `catalogProviderId` backfill)

The new registry (`Provider` / `ConfiguredModel`) is populated only when a
user adds a provider through the BYOK tab — there is no migration that moves
existing `settings.activeModels` providers/models into it. Consequences:

- Models configured before the redesign live only in `activeModels` and never
  appear in the BYOK tab.
- `ProviderOrigin.catalogProviderId` (the stable catalog back-reference the
  Configure dialog uses to re-surface the full model list) is only written by
  `ByokSetupApi.addCatalogProvider`. Any `byok` provider that predates the
  field — or a future custom-endpoint provider with no catalog — falls back to
  a synthetic catalog built from its already-configured snapshots, so the user
  can re-check existing models but can't add new ones from the live catalog.
  This is graceful today only because the registry is brand new (effectively
  no pre-field rows exist yet).

TODO: introduce a one-time migration that moves legacy `activeModels`
providers/models into the new `Provider` / `ConfiguredModel` / `BackendConfig`
registries and backfills `catalogProviderId` (matching each migrated provider
to its `models.dev` catalog id where resolvable). After this lands, the
synthetic-catalog fallback in `ConfigureProviderDialog` becomes a safety net
for genuinely catalog-less providers rather than a routine path.

## GitHub Copilot auth — runtime cleanup pending

The orphaned auth UI (`GitHubCopilotAuth.tsx`) was deleted with the
redesign, but the GitHub Copilot provider runtime is still present and
woven through several modules:

- `src/LLMProviders/githubCopilot/` (provider + chat/responses models)
- `src/constants.ts`, `src/settings/providerModels.ts`, `src/settings/model.ts`
- `src/settings/v2/utils/modelActions.ts`, `src/LLMProviders/chatModelManager.ts`
- `src/utils.ts`, encryption paths

TODO: fully remove GitHub Copilot auth support (provider runtime + all the
references above). Deferred from the redesign PR because it's a broad,
high-blast-radius removal unrelated to the settings UI.

## Local services (Ollama / LM Studio) discovery UI removed

`LocalServicesSection.tsx` was deleted with the redesign (it was only
reachable from the deleted API-key dialog). Local-endpoint support is slated
to return through the BYOK custom-provider / template flow
(`ByokSetupApi.addTemplateProvider`, currently `not implemented yet`). Until
that ships, there's no UI to discover/add locally-running models.
