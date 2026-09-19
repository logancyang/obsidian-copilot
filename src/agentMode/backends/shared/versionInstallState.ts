import type { InstallState } from "@/agentMode/session/types";
import { compareSemver } from "@/utils/semver";

/**
 * Checks a recognized semantic version against a stable release floor.
 * @param version - Release version, excluding any packaging-only revision label.
 * @param minVersion - Minimum supported stable release.
 */
export function isVersionSupported(version: string, minVersion: string): boolean {
  const order = compareSemver(version, minVersion);
  // A prerelease at the floor is older than that stable release; higher release prereleases remain usable.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/480
  return order > 0 || (order === 0 && !version.split("+")[0].includes("-"));
}

/**
 * Applies the release floor to an already recognized installation, regardless of ownership.
 * @param name - Backend label used in upgrade guidance.
 * @param currentVersion - Semantic release version reported by the recognized installation.
 * @param minVersion - Managed release target, also the minimum supported version.
 * @param source - Installation ownership retained for configuration actions.
 * @param displayVersion - Installation identity to show, including packaging-only revisions if present.
 */
export function versionInstallState(
  name: string,
  currentVersion: string,
  minVersion: string,
  source: "managed" | "custom",
  displayVersion = currentVersion
): InstallState {
  // Old custom and managed installs need the same upgrade guidance; newer releases remain usable.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/480
  if (!isVersionSupported(currentVersion, minVersion)) {
    return {
      kind: "incompatible",
      source,
      currentVersion: displayVersion,
      minVersion,
      message: `${name} v${displayVersion} is not supported. Copilot requires ${name} v${minVersion} or newer.`,
    };
  }
  return { kind: "ready", source };
}
