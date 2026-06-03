import * as fs from "node:fs";
import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";

/**
 * Build a spawn descriptor for a backend whose only configuration is a
 * user-provided binary path (no managed install, no extra args). Auth is
 * inherited from the user's environment / login state — no API key
 * injection. `envOverrides` is merged last so user values can override even
 * the augmented `PATH`.
 */
export function buildSimpleSpawnDescriptor(
  binaryPath: string | undefined,
  configErrorMessage: string,
  envOverrides?: Record<string, string>,
  /**
   * Plugin-managed env (e.g. the decrypted Copilot Plus license for builtin
   * skill scripts). Merged after `process.env` but BEFORE user `envOverrides`
   * so a user can still intentionally shadow it.
   */
  managedEnv?: Readonly<Record<string, string>>
): AcpSpawnDescriptor {
  if (!binaryPath) throw new Error(configErrorMessage);
  return {
    command: binaryPath,
    args: [],
    env: {
      ...process.env,
      PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
      ...(managedEnv ?? {}),
      ...(envOverrides ?? {}),
    },
  };
}

/**
 * `InstallState` for a user-binary backend: `ready/custom` when the configured
 * path exists on disk, else `absent`. The existence check matters across synced
 * vaults — a second device can carry the path in settings without the binary
 * being installed locally (logancyang/obsidian-copilot-preview#123); reporting
 * `absent` shows the install prompt instead of failing the spawn cryptically.
 * `fileExists` is injected so the branch is unit-testable without disk.
 */
export function binaryPathInstallState(
  binaryPath: string | undefined,
  fileExists: (path: string) => boolean = (p) => fs.existsSync(p)
): InstallState {
  if (!binaryPath || !fileExists(binaryPath)) return { kind: "absent" };
  return { kind: "ready", source: "custom" };
}

/**
 * Wrap an `AcpBackend` in `AcpBackendProcess` to satisfy the descriptor's
 * `createBackendProcess` factory. Centralizes the "ACP-track plumbing" so
 * subprocess backends (codex, opencode) don't repeat the construction.
 */
export function simpleBinaryBackendProcess(
  args: {
    plugin: CopilotPlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
  },
  backend: AcpBackend
): BackendProcess {
  return new AcpBackendProcess(args.app, backend, args.clientVersion, args.descriptor);
}
