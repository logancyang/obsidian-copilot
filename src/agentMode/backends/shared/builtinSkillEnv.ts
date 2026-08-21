import { BREVILABS_API_BASE_URL } from "@/constants";
import { type CopilotSettings, getSettings } from "@/settings/model";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import {
  MIYO_SEARCH_FOLDER_ENV,
  MIYO_SEARCH_SCOPE_ENV,
  PLUS_ENV,
} from "@/agentMode/skills/builtin/builtinSkills";
import { SYMPOSIUM_WORKSPACE_ROOT_ENV } from "@/symposium/constants";
import {
  COPILOT_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

/** Env var the bundled `miyo` CLI reads to target a non-default Miyo service. */
const MIYO_URL_ENV = "MIYO_URL";

const PROTECTED_BUILTIN_ENV_KEYS = [MIYO_SEARCH_SCOPE_ENV, MIYO_SEARCH_FOLDER_ENV] as const;

/** Frozen empty result so unmanaged spawns don't allocate a fresh object each time. */
const EMPTY_MANAGED_ENV: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Build the plugin-managed environment for builtin skill scripts. Composes
 * independent contributions. Ordinary values are merged before the user's
 * `envOverrides`; the Miyo vault-isolation inputs are protected by each
 * backend. Credentials live only in the agent subprocess env (never written to
 * disk in the skill files):
 *
 * - **Obsidian CLI** (`COPILOT_OBSIDIAN_CLI`): terminal-capable executable
 *   shipped with the running desktop install, when present. This avoids
 *   depending on the agent backend's `PATH`.
 * - **Copilot Plus relay** (`COPILOT_PLUS_*`): decrypted license key + relay
 *   base URL + user id + client version, only for an active Plus subscriber with
 *   a key on file. Absent otherwise, so the relay skills exit with the upgrade
 *   prompt.
 * - **Host review** (`SYMPOSIUM_WORKSPACE_ROOT`): owning workspace used to
 *   stage HTML and derive the wrapper's explicit Obsidian CLI vault target.
 * - **Miyo** (`MIYO_URL`): the user's custom/remote Miyo server URL when set, so
 *   the bundled `miyo` CLI targets their configured service instead of local
 *   loopback discovery (the only way Miyo works on mobile or against a remote
 *   host). `COPILOT_MIYO_SEARCH_*` also carries the authoritative Search scope
 *   and active vault name. Independent of Plus — self-host users may use Miyo
 *   without a license.
 * @param clientVersion Version reported to the Copilot Plus relay.
 * @param workspaceRootAbs Absolute host workspace root used by portable skills.
 * @param miyoFolderName Exact active-vault name Miyo resolves on its own host.
 */
export async function buildBuiltinSkillEnv(
  clientVersion = "",
  workspaceRootAbs = "",
  miyoFolderName = ""
): Promise<Readonly<Record<string, string>>> {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const settings = getSettings();
  const env: Record<string, string> = {};

  if (workspaceRootAbs) env[SYMPOSIUM_WORKSPACE_ROOT_ENV] = workspaceRootAbs;

  const obsidianCliPath = resolveObsidianCliPath({
    platform: process.platform,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    homeDir: os.homedir(),
  });
  if (obsidianCliPath) env[COPILOT_OBSIDIAN_CLI_ENV] = obsidianCliPath;

  // The CLI reads MIYO_URL; bare/local installs leave it empty and fall back to
  // loopback discovery.
  const miyoUrl = getMiyoCustomUrl(settings);
  if (miyoUrl) env[MIYO_URL_ENV] = miyoUrl;

  if (workspaceRootAbs) {
    // Only an explicit Unrestricted setting may remove the exact pre-retrieval
    // vault boundary. The active vault identity stays independent of a Project
    // session's cwd and remains portable to remote Miyo hosts.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
    env[MIYO_SEARCH_SCOPE_ENV] = settings.miyoSearchAll === true ? "unrestricted" : "current";
    if (miyoFolderName) env[MIYO_SEARCH_FOLDER_ENV] = miyoFolderName;
  }

  // Copilot Plus relay env — gated on an active subscription with a usable key.
  if (settings.isPaidUser && settings.plusLicenseKey) {
    // Relay skills still require the raw Plus credential in the agent process.
    // Do not create service-specific aliases; scoped agent credentials remain separate work.
    env[PLUS_ENV.licenseKey] = settings.plusLicenseKey;
    env[PLUS_ENV.baseUrl] = BREVILABS_API_BASE_URL;
    env[PLUS_ENV.userId] = settings.userId ?? "";
    env[PLUS_ENV.clientVersion] = clientVersion;
  }

  return Object.keys(env).length === 0 ? EMPTY_MANAGED_ENV : env;
}

/**
 * Remove Copilot-owned vault-isolation inputs from user backend overrides.
 *
 * Other managed values intentionally remain overridable. The Miyo scope values
 * are different: allowing a backend override to replace `current` with
 * `unrestricted` would silently widen a user-selected privacy boundary.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/121
 *
 * @param envOverrides Optional backend-specific user overrides.
 * @returns A copy containing only values the backend may override.
 */
export function sanitizeBuiltinSkillEnvOverrides(
  envOverrides?: Readonly<Record<string, string>>
): Record<string, string> {
  const sanitized = { ...(envOverrides ?? {}) };
  for (const key of PROTECTED_BUILTIN_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

/** How a persisted setting change should refresh the environment captured at spawn. */
export function getBuiltinSkillEnvRestartPolicy(
  prev: CopilotSettings,
  next: CopilotSettings
): "none" | "deferred" | "immediate" {
  const ordinaryEnvChanged =
    prev.isPaidUser !== next.isPaidUser ||
    prev.plusLicenseKey !== next.plusLicenseKey ||
    prev.miyoServerUrl !== next.miyoServerUrl;
  // Scope changes only affect a currently enabled skill. Tightening an active
  // boundary must cancel the current turn; widening can wait until it is idle.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
  const activeMiyoScopeChanged =
    prev.enableMiyoSearchSkill === true &&
    next.enableMiyoSearchSkill === true &&
    prev.miyoSearchAll !== next.miyoSearchAll;

  if (!ordinaryEnvChanged && !activeMiyoScopeChanged) return "none";
  if (activeMiyoScopeChanged && prev.miyoSearchAll === true && next.miyoSearchAll !== true) {
    return "immediate";
  }
  return "deferred";
}
