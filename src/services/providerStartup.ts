import type { ModelManagementApi, ProviderCredentialReconciliationResult } from "@/modelManagement";
import { runSettingsMigrations } from "@/settings/migrations";

/**
 * Prepare provider settings and device-local credentials before provider discovery begins.
 * Versioned name repair must settle first because it determines each credential's destination.
 */
export async function prepareProviderStartup(
  api: ModelManagementApi
): Promise<ProviderCredentialReconciliationResult> {
  await runSettingsMigrations(api);
  return api.providerRegistry.reconcileCredentials();
}
