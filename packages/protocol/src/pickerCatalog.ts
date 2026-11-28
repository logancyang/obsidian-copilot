import type { ModelCapability } from "@copilot/core/modelCapability";
import type { EffortOption } from "@copilot/core/modelEffort";
import type { BackendId, ModelEntry, ModelSelection } from "@copilot/protocol/backendState";

export type EnabledModelCredentialState = "ok" | "missing_key";

export interface EnabledModelEntry {
  baseModelId: string;
  name: string;
  label?: string;
  description?: string;
  credentialState: EnabledModelCredentialState;
  capabilities?: ModelCapability[];
  isFree?: boolean;
  needsSelfHostWarning?: boolean;
}

export type ReportedModel = Pick<
  ModelEntry,
  "baseModelId" | "name" | "description" | "effortOptions"
>;

export type InstallKind = "absent" | "checking" | "ready" | "incompatible" | "error";

export type PreloadStatus = "pending" | "ready" | "error" | "absent";

export interface LockedPreviewModel {
  name: string;
  provider: string;
  displayName?: string;
  subtitle?: string;
  disabledReason?: string;
}

export interface PickerAgent {
  id: BackendId;
  displayName: string;
  routesCopilotModels: boolean;
  installKind: InstallKind;
  preload: PreloadStatus;
  selfHostWarning: boolean;
  enabledModels: EnabledModelEntry[] | null;
  modelCatalog: { availableModels: ReportedModel[] | null } | null;
  blockedModels: { baseModelIds: string[]; reason: string; hint: string } | null;
  effortCatalog: Record<string, EffortOption[]> | null;
  defaultSelection: ModelSelection | null;
  lockedPreview: LockedPreviewModel[];
}

export interface PickerCatalog {
  defaultAgent: BackendId | null;
  agents: PickerAgent[];
}

export const EMPTY_PICKER_CATALOG: PickerCatalog = Object.freeze({
  defaultAgent: null,
  agents: Object.freeze([]) as unknown as PickerAgent[],
});
