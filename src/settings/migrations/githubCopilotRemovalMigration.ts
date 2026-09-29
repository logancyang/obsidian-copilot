// A saved model naming the removed GitHub Copilot provider can never be instantiated, and its
// keychain-backed tokens outlive the settings fields unless deleted explicitly:
// https://github.com/logancyang/obsidian-copilot-preview/issues/316

import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { type CopilotSettings, setSettings } from "@/settings/model";

const REMOVED_PROVIDER = "github-copilot";

const REMOVED_SECRET_KEYS = ["githubCopilotAccessToken", "githubCopilotToken"] as const;

function referencesRemovedProvider(modelKey: string | undefined): boolean {
  return modelKey?.endsWith(`|${REMOVED_PROVIDER}`) ?? false;
}

export function planGitHubCopilotRemoval(
  settings: CopilotSettings
): Partial<CopilotSettings> | null {
  const patch: Partial<CopilotSettings> = {};

  const models = settings.activeModels ?? [];
  const keptModels = models.filter((model) => model.provider !== REMOVED_PROVIDER);
  if (keptModels.length !== models.length) patch.activeModels = keptModels;

  if (referencesRemovedProvider(settings.defaultModelKey)) patch.defaultModelKey = "";

  if (referencesRemovedProvider(settings.quickCommandModelKey))
    patch.quickCommandModelKey = undefined;

  const projects = settings.projectList ?? [];
  if (projects.some((project) => referencesRemovedProvider(project.projectModelKey))) {
    patch.projectList = projects.map((project) =>
      referencesRemovedProvider(project.projectModelKey)
        ? { ...project, projectModelKey: "" }
        : project
    );
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function executeGitHubCopilotRemoval(settings: CopilotSettings): void {
  const patch = planGitHubCopilotRemoval(settings);
  if (patch) setSettings(patch);

  try {
    const keychain = KeychainService.getInstance();
    if (!keychain.isAvailable()) return;
    for (const key of REMOVED_SECRET_KEYS) {
      keychain.deleteSecret(key);
    }
  } catch (error) {
    logWarn("[github-copilot-removal] could not delete the stored OAuth tokens", error);
  }
}
