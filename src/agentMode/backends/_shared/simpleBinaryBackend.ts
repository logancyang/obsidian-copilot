import type { AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import type { InstallState } from "@/agentMode/session/types";

/**
 * Build a spawn descriptor for a backend whose only configuration is a
 * user-provided binary path (no managed install, no extra args). Auth is
 * inherited from the user's environment / login state — no API key
 * injection.
 */
export function buildSimpleSpawnDescriptor(
  binaryPath: string | undefined,
  configErrorMessage: string
): AcpSpawnDescriptor {
  if (!binaryPath) throw new Error(configErrorMessage);
  return {
    command: binaryPath,
    args: [],
    env: {
      ...process.env,
      PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
    },
  };
}

/**
 * `InstallState` for the same shape: a binaryPath either is set
 * (`ready/custom`) or it is not (`absent`).
 */
export function binaryPathInstallState(binaryPath: string | undefined): InstallState {
  return binaryPath ? { kind: "ready", source: "custom" } : { kind: "absent" };
}
