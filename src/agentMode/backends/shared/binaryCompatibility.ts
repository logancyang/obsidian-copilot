import type { InstallState } from "@/agentMode/session/types";
import { compareSemver } from "@/utils/semver";

export type BinaryInspection =
  | { kind: "absent" }
  | { kind: "error"; message: string }
  | { kind: "installed"; version: string; source: "managed" | "custom" };

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Applies the same support floor to backend-owned installation inspection.
 * @param inspection - Backend-validated package or executable and actual runtime version.
 * @param minimumVersion - Oldest stable release supporting the plugin contract.
 * @param displayName - Agent name used in actionable configuration errors.
 */
export function classifyBinaryInstall(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): InstallState {
  if (inspection.kind !== "installed") return inspection;
  const parsed = VERSION_PATTERN.exec(inspection.version);
  // Invalid metadata must not make a configured runtime appear ready. ISSUE_PENDING
  if (!parsed || !VERSION_PATTERN.test(minimumVersion)) {
    return {
      kind: "error",
      message: `${displayName} has invalid version metadata. Configure a valid installation.`,
    };
  }
  const order = compareSemver(inspection.version, minimumVersion);
  // Prereleases of the minimum do not guarantee its stable protocol contract. ISSUE_PENDING
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
 * Rejects execution or download of an installation outside the shared support contract.
 * @param inspection - Inspected runtime captured by the caller.
 * @param minimumVersion - Minimum supported stable runtime version.
 * @param displayName - Agent name for the failure message.
 */
export function assertBinaryCompatible(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): void {
  const state = classifyBinaryInstall(inspection, minimumVersion, displayName);
  // Execution cannot recover from missing or invalid packages without configuration. ISSUE_PENDING
  if (state.kind !== "ready")
    throw new Error(
      "message" in state
        ? state.message
        : `${displayName} is not installed. Configure an installation.`
    );
}
