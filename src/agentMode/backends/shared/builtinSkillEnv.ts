import { BREVILABS_API_BASE_URL } from "@/constants";
import { type CopilotSettings, getSettings, normalizeMiyoFolderNames } from "@/settings/model";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import {
  MIYO_SEARCH_EXTRA_FOLDER_ARGS_ENV,
  MIYO_SEARCH_EXTRA_FOLDERS_ENV,
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
  PLUS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/builtinSkills/builtinSkills";
import { OPENARTIFACTS_WORKSPACE_ROOT_ENV } from "@/openArtifacts/constants";
import {
  COPILOT_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { BackendId } from "@/agentMode/session/types";

const MIYO_URL_ENV = "MIYO_URL";

const PROTECTED_BUILTIN_ENV_KEYS = [
  MIYO_SEARCH_SCOPE_ENV,
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_EXTRA_FOLDERS_ENV,
  MIYO_SEARCH_EXTRA_FOLDER_ARGS_ENV,
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
] as const;

const EMPTY_MANAGED_ENV: Readonly<Record<string, string>> = Object.freeze({});

export async function buildBuiltinSkillEnv(
  clientVersion = "",
  workspaceRootAbs = "",
  vaultName = "",
  selfHostSearchChannel?: Readonly<{ url: string; token: string }>
): Promise<Readonly<Record<string, string>>> {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const settings = getSettings();
  const env: Record<string, string> = {};

  if (workspaceRootAbs) env[OPENARTIFACTS_WORKSPACE_ROOT_ENV] = workspaceRootAbs;

  const obsidianCliPath = resolveObsidianCliPath({
    platform: process.platform,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    homeDir: os.homedir(),
  });
  if (obsidianCliPath) env[COPILOT_OBSIDIAN_CLI_ENV] = obsidianCliPath;

  // The channel values are protected from backend overrides so Self-Host mode
  // cannot silently fall back to a hosted or agent-native search path.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
  if (settings.enableSelfHostMode === true && selfHostSearchChannel) {
    env[SELF_HOST_WEB_SEARCH_ENV] = "1";
    env[SELF_HOST_WEB_SEARCH_URL_ENV] = selfHostSearchChannel.url;
    env[SELF_HOST_WEB_SEARCH_TOKEN_ENV] = selfHostSearchChannel.token;
  }

  const miyoUrl = getMiyoCustomUrl(settings);
  if (miyoUrl) env[MIYO_URL_ENV] = miyoUrl;

  if (workspaceRootAbs) {
    // Only an explicit Unrestricted setting may remove the exact pre-retrieval
    // vault boundary. The active vault identity stays independent of a Project
    // session's cwd and remains portable to remote Miyo hosts.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
    env[MIYO_SEARCH_SCOPE_ENV] = settings.miyoSearchAll === true ? "unrestricted" : "current";
    if (vaultName) env[MIYO_SEARCH_FOLDER_ENV] = vaultName;
    const extraFolders = normalizeMiyoFolderNames(settings.miyoExtraSearchFolders).filter(
      (name) => name !== vaultName
    );
    // Ticked folders widen only Current vault scope. sh splits the list on "/", which no stored
    // name contains; cmd gets pre-quoted arguments because splitting a list there needs delayed
    // expansion or call, which re-expand ! or % in a name.
    // https://github.com/logancyang/obsidian-copilot/issues/3508
    if (settings.miyoSearchAll !== true && extraFolders.length > 0) {
      env[MIYO_SEARCH_EXTRA_FOLDERS_ENV] = extraFolders.join("/");
      env[MIYO_SEARCH_EXTRA_FOLDER_ARGS_ENV] = extraFolders
        .map((name) => `--folder "${name}"`)
        .join(" ");
    }
  }

  if (settings.isPaidUser && settings.plusLicenseKey) {
    env[PLUS_ENV.licenseKey] = settings.plusLicenseKey;
    env[PLUS_ENV.baseUrl] = BREVILABS_API_BASE_URL;
    env[PLUS_ENV.userId] = settings.userId ?? "";
    env[PLUS_ENV.clientVersion] = clientVersion;
  }

  return Object.keys(env).length === 0 ? EMPTY_MANAGED_ENV : env;
}

// An override replacing `current` with `unrestricted` would silently widen the user's Miyo privacy boundary.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/121
export function sanitizeBuiltinSkillEnvOverrides(
  envOverrides?: Readonly<Record<string, string>>
): Record<string, string> {
  const sanitized = { ...(envOverrides ?? {}) };
  for (const key of PROTECTED_BUILTIN_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

export function getBuiltinSkillEnvRestartPolicy(
  prev: CopilotSettings,
  next: CopilotSettings,
  backendId: BackendId
): "none" | "deferred" | "immediate" {
  const ordinaryEnvChanged =
    prev.isPaidUser !== next.isPaidUser ||
    prev.plusLicenseKey !== next.plusLicenseKey ||
    prev.miyoConnectionMode !== next.miyoConnectionMode ||
    prev.miyoServerUrl !== next.miyoServerUrl;
  const selfHostRoutingChanged =
    backendId === "opencode" && prev.enableSelfHostMode !== next.enableSelfHostMode;
  // Scope changes only affect a currently enabled skill. Tightening an active
  // boundary must cancel the current turn; widening can wait until it is idle.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
  const activeMiyoSkill =
    prev.enableMiyoSearchSkill === true && next.enableMiyoSearchSkill === true;
  const activeMiyoScopeChanged = activeMiyoSkill && prev.miyoSearchAll !== next.miyoSearchAll;
  // Ticked folders widen only Current vault scope, so unticking one tightens the boundary.
  // https://github.com/logancyang/obsidian-copilot/issues/3508
  const currentScopeKept =
    activeMiyoSkill && prev.miyoSearchAll !== true && next.miyoSearchAll !== true;
  const extraFolderRemoved =
    currentScopeKept &&
    prev.miyoExtraSearchFolders.some((name) => !next.miyoExtraSearchFolders.includes(name));
  const extraFolderAdded =
    currentScopeKept &&
    next.miyoExtraSearchFolders.some((name) => !prev.miyoExtraSearchFolders.includes(name));

  if (extraFolderRemoved) return "immediate";
  if (
    !ordinaryEnvChanged &&
    !selfHostRoutingChanged &&
    !activeMiyoScopeChanged &&
    !extraFolderAdded
  ) {
    return "none";
  }
  if (
    selfHostRoutingChanged &&
    prev.enableSelfHostMode !== true &&
    next.enableSelfHostMode === true
  ) {
    return "immediate";
  }
  if (activeMiyoScopeChanged && prev.miyoSearchAll === true && next.miyoSearchAll !== true) {
    return "immediate";
  }
  return "deferred";
}
