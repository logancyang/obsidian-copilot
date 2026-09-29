// A saved Bedrock provider can never build a client again but stays selectable in the model list:
// https://github.com/logancyang/obsidian-copilot/issues/2928

import type { ModelManagementApi } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

const REMOVED_PROVIDER_TYPE = "bedrock";

const REMOVED_LEGACY_PROVIDERS = ["amazon-bedrock"] as const;

const REMOVED_LEGACY_SECRET_FIELD = "amazonBedrockApiKey";

export type BedrockRemovalPlan = RetiredProviderRemovalPlan;

export function planBedrockRemoval(settings: CopilotSettings): BedrockRemovalPlan | null {
  return planRetiredProviderRemoval(settings, REMOVED_PROVIDER_TYPE, REMOVED_LEGACY_PROVIDERS);
}

export async function executeBedrockRemoval(
  api: ModelManagementApi,
  settings: CopilotSettings
): Promise<void> {
  await executeRetiredProviderRemoval(
    api,
    planBedrockRemoval(settings),
    REMOVED_LEGACY_SECRET_FIELD,
    "bedrock-removal"
  );
}
