# Model Management — layer rules

The chat-model data model: providers, configured models, per-backend
model selection, and the transient catalog types used during setup.

## Architecture in one paragraph

`models.dev` (the catalog) is consumed **only during setup**. When the
user adds a provider via BYOK, when an agent is configured, a `Provider` row
is created with an
`origin` discriminator (`byok` / `agent` / `copilot-plus`). Each
provider has zero or more `ConfiguredModel` rows under it, each
embedding a `ModelInfo` snapshot copied from the catalog (or
hand-typed for self-hosted endpoints). The plugin keeps working
when the catalog is unreachable because every runtime-relevant field
lives in `ConfiguredModel.info`. The four backends that curate model
selection — `chat`, `opencode`, `claude`, `codex` — each persist a
`BackendConfig` listing `configuredModelId`s they expose in their
picker. The BYOK settings tab filters `providers` by
`origin.kind === "byok"`; the chat-model factory dispatches purely on
`Provider.providerType`.
