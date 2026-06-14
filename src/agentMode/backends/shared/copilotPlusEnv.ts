import { BREVILABS_API_BASE_URL } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { PLUS_ENV } from "@/agentMode/skills/builtin/builtinSkills";

/** Env var the bundled `miyo` CLI reads to target a non-default Miyo service. */
const MIYO_URL_ENV = "MIYO_URL";

/** Frozen empty result so unmanaged spawns don't allocate a fresh object each time. */
const EMPTY_PLUS_ENV: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Build the plugin-managed environment for builtin skill scripts. Composes two
 * independent contributions, both merged BEFORE the user's `envOverrides` so a
 * user can still shadow them; the decrypted key lives only in the agent
 * subprocess env (never written to disk in the skill files):
 *
 * - **Copilot Plus relay** (`COPILOT_PLUS_*`): decrypted license key + relay
 *   base URL + user id + client version, only for an active Plus subscriber with
 *   a key on file. Absent otherwise, so the relay skills exit with the upgrade
 *   prompt.
 * - **Miyo** (`MIYO_URL`): the user's custom/remote Miyo server URL when set, so
 *   the bundled `miyo` CLI targets their configured service instead of local
 *   loopback discovery (the only way Miyo works on mobile or against a remote
 *   host). Independent of Plus — self-host users may use Miyo without a license.
 */
export async function buildCopilotPlusEnv(
  clientVersion = ""
): Promise<Readonly<Record<string, string>>> {
  const settings = getSettings();
  const env: Record<string, string> = {};

  // The CLI reads MIYO_URL; bare/local installs leave it empty and fall back to
  // loopback discovery.
  const miyoUrl = getMiyoCustomUrl(settings);
  if (miyoUrl) env[MIYO_URL_ENV] = miyoUrl;

  // Copilot Plus relay env — gated on an active subscription with a usable key.
  if (settings.isPlusUser && settings.plusLicenseKey) {
    try {
      const licenseKey = await getDecryptedKey(settings.plusLicenseKey);
      if (licenseKey) {
        env[PLUS_ENV.licenseKey] = licenseKey;
        env[PLUS_ENV.baseUrl] = BREVILABS_API_BASE_URL;
        env[PLUS_ENV.userId] = settings.userId ?? "";
        env[PLUS_ENV.clientVersion] = clientVersion;
      }
    } catch (e) {
      logWarn("[AgentMode] could not decrypt Copilot Plus license key for agent env", e);
    }
  }

  return Object.keys(env).length === 0 ? EMPTY_PLUS_ENV : env;
}
