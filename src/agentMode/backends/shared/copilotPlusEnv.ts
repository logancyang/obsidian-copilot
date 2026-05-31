import { BREVILABS_API_BASE_URL } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { PLUS_ENV } from "@/agentMode/skills/builtin/builtinSkills";

/** Frozen empty result so non-Plus spawns don't allocate a fresh object each time. */
const EMPTY_PLUS_ENV: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Build the plugin-managed environment that lets builtin Copilot Plus skill
 * scripts reach the Brevilabs relay (see `builtinSkills.ts`). Returns the
 * decrypted license key + relay base URL + user id (and client version) when
 * the user is an active Plus subscriber with a key on file; otherwise an empty
 * object, so the skills' scripts exit with the upgrade prompt.
 *
 * This is deliberately separate from user-configured `envOverrides`: it is
 * decrypted fresh at spawn time and must be merged BEFORE user overrides so a
 * user can still shadow it intentionally. The decrypted key lives only in the
 * agent subprocess env (never written to disk in the skill files).
 */
export async function buildCopilotPlusEnv(
  clientVersion = ""
): Promise<Readonly<Record<string, string>>> {
  const settings = getSettings();
  if (!settings.isPlusUser) return EMPTY_PLUS_ENV;
  if (!settings.plusLicenseKey) return EMPTY_PLUS_ENV;

  let licenseKey: string;
  try {
    licenseKey = await getDecryptedKey(settings.plusLicenseKey);
  } catch (e) {
    logWarn("[AgentMode] could not decrypt Copilot Plus license key for agent env", e);
    return EMPTY_PLUS_ENV;
  }
  if (!licenseKey) return EMPTY_PLUS_ENV;

  return {
    [PLUS_ENV.licenseKey]: licenseKey,
    [PLUS_ENV.baseUrl]: BREVILABS_API_BASE_URL,
    [PLUS_ENV.userId]: settings.userId ?? "",
    [PLUS_ENV.clientVersion]: clientVersion,
  };
}
