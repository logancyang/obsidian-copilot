import { DEFAULT_SETTINGS } from "@/constants";
import { stripLegacyIndexSettings } from "@/settings/migrations/legacyIndexSettings";
import { type CopilotSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";

export const MODEL_SECRET_FIELDS = ["apiKey"] as const;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized.includes("apikey") ||
    lower.endsWith("token") ||
    lower.endsWith("accesstoken") ||
    lower.endsWith("secret") ||
    lower.endsWith("password") ||
    lower.endsWith("licensekey")
  );
}

export const TOP_LEVEL_SECRET_FIELDS: readonly string[] = Object.freeze(
  Object.keys(DEFAULT_SETTINGS as unknown as Record<string, unknown>).filter(isSensitiveKey)
);

function asRecord(obj: CopilotSettings): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

export function hasPersistedSecrets(rawData: Record<string, unknown>): boolean {
  for (const key of Object.keys(rawData)) {
    if (!isSensitiveKey(key)) continue;
    const value = rawData[key];
    if (typeof value === "string" && value.length > 0) return true;
  }

  // Scan every top-level model-like list so credentials in a retired list are
  // backed up before the migration strips that list from persisted settings.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/283
  for (const models of Object.values(rawData)) {
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const rec = model as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = rec[field];
        if (typeof value === "string" && value.length > 0) return true;
      }
    }
  }

  return false;
}

export function stripKeychainFields(settings: CopilotSettings): CopilotSettings {
  const out = asRecord({ ...settings });

  for (const key of Object.keys(out)) {
    if (!isSensitiveKey(key)) continue;
    out[key] = "";
  }

  if ("activeModels" in out) {
    out.activeModels = stripModelSecrets(settings.activeModels ?? []);
  }
  return out as unknown as CopilotSettings;
}

function stripModelSecrets(models: CustomModel[]): CustomModel[] {
  if (!models?.length) return models;

  return models.map((model) => {
    const copy = { ...model } as unknown as Record<string, unknown>;
    for (const field of MODEL_SECRET_FIELDS) {
      copy[field] = "";
    }
    return copy as unknown as CustomModel;
  });
}

export function cleanupLegacyFields(settings: CopilotSettings): CopilotSettings {
  const out = asRecord(stripLegacyIndexSettings(settings));
  delete out.enableEncryption;
  delete out._keychainMigrated;
  delete out._keychainMigratedAt;
  delete out._migrationModalDismissed;
  delete out._diskSecretsCleared;
  delete out._keychainOnly;
  delete out.githubCopilotAccessToken;
  delete out.githubCopilotToken;
  delete out.githubCopilotTokenExpiresAt;
  delete out.miyoSyncedExclusions;
  if (out.agentMode && typeof out.agentMode === "object" && !Array.isArray(out.agentMode)) {
    const agentMode = { ...(out.agentMode as Record<string, unknown>) };
    delete agentMode.mcpServers;
    out.agentMode = agentMode;
  }
  return out as unknown as CopilotSettings;
}
