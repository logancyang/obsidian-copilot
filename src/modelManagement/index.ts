// Public surface of the model-management module. Host code must import
// from this barrel — deep imports of `@/modelManagement/types/*` and
// other internals are blocked by `no-restricted-imports` patterns in
// eslint.config.mjs.

// ---------------------------------------------------------------------------
// Data-model types
// ---------------------------------------------------------------------------

export type { CatalogProvider, ModelInfo, ProviderType } from "./types/catalog";
export type {
  AgentType,
  BackendConfig,
  BackendType,
  ConfiguredModel,
  Provider,
  ProviderOrigin,
} from "./types/persisted";
export type {
  BuiltChatModel,
  EnabledBackendEntry,
  ProviderDefinition,
  RefreshResult,
  VerificationResult,
} from "./types/runtime";

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export { CatalogDownloadService } from "./catalog/CatalogDownloadService";
export type { CatalogDownloadDeps, CatalogRefreshResult } from "./catalog/CatalogDownloadService";

export { ProviderRegistry } from "./providers/ProviderRegistry";
export { isSelfHostedProvider, isSelfHostedUrl } from "./providers/isSelfHostedProvider";
export { providerRequiresApiKey } from "./providers/providerRequiresApiKey";
export { ConfiguredModelRegistry } from "./models/ConfiguredModelRegistry";
export { BackendConfigRegistry } from "./backends/BackendConfigRegistry";
export { ChatModelFactory } from "./chatModel/ChatModelFactory";
export {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./chatModel/configuredModelToCustomModel";
export {
  findChatBackendEntry,
  isChatModelSelectionForEntry,
  resolveChatModelSelectionId,
} from "./chatModel/chatModelSelection";
export type { ResolvedChatBackendEntry } from "./chatModel/chatModelSelection";
export { resolveChatBackendModel } from "./chatModel/resolveChatBackendModel";
export type { ChatBackendResolution } from "./chatModel/resolveChatBackendModel";
export {
  capabilityListFromModelInfo,
  capabilitiesFromConfiguredInfo,
} from "./chatModel/modelCapabilityFlags";

// ---------------------------------------------------------------------------
// Provider adapter contract
// ---------------------------------------------------------------------------

export {
  createDefaultAdapterRegistry,
  ProviderAdapterRegistry,
} from "./providers/adapters/ProviderAdapterRegistry";
export type {
  AdapterBuildContext,
  AdapterVerifyContext,
  ProviderAdapter,
} from "./providers/adapters/ProviderAdapter";

// ---------------------------------------------------------------------------
// Setup APIs (one per ProviderOrigin.kind)
// ---------------------------------------------------------------------------

export { ByokSetupApi, BYOK_DEFAULT_AUTO_ENROLL } from "./setup/ByokSetupApi";
export type { AddModelsInput, ByokSetupResult, SetupProviderInput } from "./setup/ByokSetupApi";

export { AgentSetupApi } from "./setup/AgentSetupApi";
export type {
  AgentSetupResult,
  AgentSyncResult,
  RegisterAgentProviderInput,
  SyncAgentModelsInput,
} from "./setup/AgentSetupApi";

export { CopilotPlusSetupApi } from "./setup/CopilotPlusSetupApi";
export type { PlusSetupResult, RegisterPlusProviderInput } from "./setup/CopilotPlusSetupApi";
export { COPILOT_PLUS_MODELS, syncCopilotPlusProvider } from "./setup/copilotPlusSync";

// ---------------------------------------------------------------------------
// Top-level factory + coordinator
// ---------------------------------------------------------------------------

export { createModelManagement, ModelManagementCoordinator } from "./createModelManagement";
export type { CreateModelManagementInput, ModelManagementApi } from "./createModelManagement";

// ---------------------------------------------------------------------------
// Reactive atoms (Jotai)
//
// React: `useAtomValue(<atom>, { store: settingsStore })`
// Non-React subscribers: `settingsStore.sub(<atom>, listener)`
// ---------------------------------------------------------------------------

export {
  agentProvidersAtom,
  backendPickerAtomFamily,
  backendsAtom,
  byokProvidersAtom,
  configuredModelsAtom,
  copilotPlusProvidersAtom,
  providersAtom,
} from "./state/atoms";

// ---------------------------------------------------------------------------
// React context for mutation access (reads use atoms directly)
// ---------------------------------------------------------------------------

export { ModelManagementProvider, useModelManagement } from "./ui/ModelManagementContext";

// ---------------------------------------------------------------------------
// Settings UI (BYOK tab)
// ---------------------------------------------------------------------------

export { ByokPanel } from "./ui/tabs/ByokPanel";
