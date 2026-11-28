import type { ModelCapability } from "@copilot/core/modelCapability";

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
