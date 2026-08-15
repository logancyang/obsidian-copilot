import { BREVILABS_API_BASE_URL } from "@/constants";
import { getSettings } from "@/settings/model";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { PLUS_ENV } from "@/agentMode/skills/builtin/builtinSkills";
import { SYMPOSIUM_WORKSPACE_ROOT_ENV } from "@/symposium/constants";
import {
  COPILOT_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

/** Env var the bundled `miyo` CLI reads to target a non-default Miyo service. */
const MIYO_URL_ENV = "MIYO_URL";

/** Frozen empty result so unmanaged spawns don't allocate a fresh object each time. */
const EMPTY_MANAGED_ENV: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Build the plugin-managed environment for builtin skill scripts. Composes
 * independent contributions, all merged BEFORE the user's `envOverrides` so a
 * user can still shadow them; the credential lives only in the agent
 * subprocess env (never written to disk in the skill files):
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
 *   host). Independent of Plus — self-host users may use Miyo without a license.
 * @param clientVersion Version reported to the Copilot Plus relay.
 * @param workspaceRootAbs Absolute host workspace root used by portable skills.
 */
export async function buildBuiltinSkillEnv(
  clientVersion = "",
  workspaceRootAbs = ""
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
