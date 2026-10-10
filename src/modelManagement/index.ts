export type { ModelInfo, ProviderType } from "./types/catalog";
export type {
  AgentType,
  BackendConfig,
  BackendType,
  ConfiguredModel,
  PersistedCopilotPlusCatalog,
  Provider,
  ProviderOrigin,
} from "./types/persisted";
export type { EnabledBackendEntry } from "./types/runtime";

export { ProviderRegistry } from "./providers/ProviderRegistry";
export { isSelfHostedProvider } from "./providers/isSelfHostedProvider";
export {
  COPILOT_PLUS_DESTINATION,
  providerDestination,
  urlDestination,
} from "./providers/providerDestination";
export { providerNeedsSelfHostWarning } from "./providers/selfHostPolicy";
export {
  providerNeedsResolvedApiKey,
  providerRequiresApiKey,
} from "./providers/providerRequiresApiKey";
export { BackendConfigRegistry } from "./backends/BackendConfigRegistry";
export {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./chatModel/configuredModelToCustomModel";
export { findChatBackendEntry, resolveChatModelSelectionId } from "./chatModel/chatModelSelection";
export { resolveChatBackendModel } from "./chatModel/resolveChatBackendModel";
export { capabilitiesFromConfiguredInfo } from "./chatModel/modelCapabilityFlags";

export type { SetupProviderInput } from "./setup/ByokSetupApi";

export { plusSyncNeeded, syncCopilotPlusProvider } from "./setup/copilotPlusSync";

export { createModelManagement } from "./createModelManagement";
export type { ModelManagementApi } from "./createModelManagement";

export {
  chatBackendPickerAtom,
  backendsAtom,
  configuredModelsAtom,
  copilotPlusCatalogAtom,
  providersAtom,
} from "./state/atoms";

export { ModelManagementProvider, useModelManagement } from "./ui/ModelManagementContext";

export { ByokPanel } from "./ui/tabs/ByokPanel";
