import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import type { BackendProcess, InstallState } from "@/agentMode/session/types";

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

/**
 * Wrap an `AcpBackend` in `AcpBackendProcess` to satisfy the descriptor's
 * `createBackendProcess` factory. Centralizes the "ACP-track plumbing" so
 * subprocess backends (codex, opencode) don't repeat the construction.
 */
export function simpleBinaryBackendProcess(
  args: { plugin: CopilotPlugin; app: App; clientVersion: string },
  backend: AcpBackend
): BackendProcess {
  return new AcpBackendProcess(args.app, backend, args.clientVersion);
}
