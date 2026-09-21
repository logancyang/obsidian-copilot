import type { InstallState } from "@/agentMode/session/types";
import { compareSemver } from "@/utils/semver";

export type BinaryInspection =
  | { kind: "absent" }
  | { kind: "error"; message: string }
  | { kind: "installed"; version: string; source: "managed" | "custom" };

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Determines whether an agent installation meets Copilot's minimum version requirement.
 * Returns `ready` for supported versions, `incompatible` for older versions or
 * prereleases of the minimum version, and `error` for invalid version metadata.
 * Missing installations and existing inspection errors pass through unchanged.
 *
 * @param inspection - Installation details already checked by the caller, including the runtime version.
 * @param minimumVersion - Oldest stable agent version Copilot supports.
 * @param displayName - Agent name to include in error messages.
 */
export function classifyBinaryInstall(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): InstallState {
  if (inspection.kind !== "installed") return inspection;
  const parsed = VERSION_PATTERN.exec(inspection.version);
  // Invalid metadata must not make a configured runtime appear ready. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
  if (!parsed || !VERSION_PATTERN.test(minimumVersion)) {
    return {
      kind: "error",
      message: `${displayName} has invalid version metadata. Configure a valid installation.`,
    };
  }
  const order = compareSemver(inspection.version, minimumVersion);
  // Prereleases of the minimum do not guarantee its stable protocol contract. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
  if (order < 0 || (order === 0 && parsed[4] !== undefined)) {
    return {
      kind: "incompatible",
      source: inspection.source,
      currentVersion: inspection.version,
      minVersion: minimumVersion,
      message: `${displayName} v${inspection.version} is not supported. Copilot requires ${displayName} v${minimumVersion} or newer.`,
    };
  }
  return { kind: "ready", source: inspection.source };
}

/**
 * Throws when an agent installation is missing, has invalid version metadata,
 * or fails Copilot's minimum version requirement. Call before launching an agent
 * or selecting a release to download.
 *
 * @param inspection - Installation details or proposed download version to validate.
 * @param minimumVersion - Oldest stable agent version Copilot supports.
 * @param displayName - Agent name to include in error messages.
 */
export function assertBinaryCompatible(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): void {
  const state = classifyBinaryInstall(inspection, minimumVersion, displayName);
  // Execution cannot recover from missing or invalid packages without configuration. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
  if (state.kind !== "ready")
    throw new Error(
      "message" in state
        ? state.message
        : `${displayName} is not installed. Configure an installation.`
    );
}
