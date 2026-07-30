import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import {
  CompatibilityStore,
  type CompatibilityRefreshOptions,
  type CompatibilityStoreInput,
} from "@/agentMode/backends/shared/compatibilityStore";
import type { InstallState } from "@/agentMode/session/types";
import { codexAcpInvocation } from "./codexBinaryResolver";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;
const MAINTAINED_ADAPTER_VERSION =
  /^@agentclientprotocol\/codex-acp\s+\d+\.\d+\.\d+(?:[-+][^\s]+)?\s*$/;

export const CODEX_REMOVE_LEGACY_COMMAND = "npm uninstall -g @zed-industries/codex-acp";
export const CODEX_INSTALL_COMMAND = "npm install -g @agentclientprotocol/codex-acp";
export const CODEX_ACP_UPDATE_MESSAGE = `Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Run ${CODEX_REMOVE_LEGACY_COMMAND}, then ${CODEX_INSTALL_COMMAND}, and select the new codex-acp path.`;

export type CodexVersionRunner = (
  binaryPath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number }
) => Promise<{ stdout: string }>;

interface RefreshOptions extends CompatibilityRefreshOptions {
  envOverrides?: Record<string, string>;
  run?: CodexVersionRunner;
}

interface CodexCompatibilityInput extends CompatibilityStoreInput {
  binaryPath: string;
  env: NodeJS.ProcessEnv;
}

interface CodexCompatibilitySelection {
  binaryPath: string;
  envOverrides?: Record<string, string>;
}

function codexCompatibilityInput(
  binaryPath: string,
  envOverrides?: Record<string, string>
): CodexCompatibilityInput {
  const environmentKey = JSON.stringify(
    Object.entries(envOverrides ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  return {
    cacheKey: `${binaryPath}\u0000${environmentKey}`,
    binaryPath,
    source: "custom",
    env: {
      ...process.env,
      PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
      ...(envOverrides ?? {}),
    },
  };
}

/**
 * Positively identifies the maintained Codex ACP adapter without starting an ACP session.
 * @param binaryPath - The selected executable whose package identity should be verified.
 * @param run - The command runner used to read the executable's local identity.
 * @param platform - The device platform used to translate Windows npm command shims.
 * @param env - The effective environment the adapter process will inherit.
 */
export async function probeCodexAcpCompatibility(
  binaryPath: string,
  run: CodexVersionRunner = execFileAsync,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
  }
): Promise<InstallState> {
  try {
    const invocation = codexAcpInvocation(binaryPath, platform);
    const { stdout } = await run(invocation.command, [...invocation.args, "--version"], {
      env,
      timeout: VERSION_TIMEOUT_MS,
    });
    if (MAINTAINED_ADAPTER_VERSION.test(stdout)) {
      return { kind: "ready", source: "custom" };
    }
  } catch {
    // The superseded adapter rejects --version; every unverified executable follows the same recovery path.
  }
  return { kind: "error", message: CODEX_ACP_UPDATE_MESSAGE };
}

const codexCompatibilityStore = new CompatibilityStore<CodexCompatibilityInput, RefreshOptions>(
  (input, options) =>
    probeCodexAcpCompatibility(input.binaryPath, options.run, process.platform, input.env)
);

/**
 * Gives synchronous consumers the latest result for a selected executable.
 * @param binaryPath - The selected executable whose compatibility should be read.
 */
export function getCodexCompatibility(
  binaryPath: string,
  envOverrides?: Record<string, string>
): InstallState {
  return codexCompatibilityStore.get(codexCompatibilityInput(binaryPath, envOverrides));
}

/**
 * Refreshes one executable's identity and publishes the settled result.
 * @param binaryPath - The selected executable whose compatibility should be checked.
 * @param options - The cache policy and command runner governing the check.
 */
export function refreshCodexCompatibility(
  binaryPath: string,
  options: RefreshOptions = {}
): Promise<InstallState> {
  return codexCompatibilityStore.refresh(
    codexCompatibilityInput(binaryPath, options.envOverrides),
    options
  );
}

/**
 * Notifies a consumer only when the currently selected runtime changes state.
 * @param getCurrent - Resolves the path and environment currently selected in settings.
 * @param listener - The consumer to notify after matching checking and settled transitions.
 */
export function subscribeCodexCompatibility(
  getCurrent: () => CodexCompatibilitySelection | null,
  listener: () => void
): () => void {
  return codexCompatibilityStore.subscribe((cacheKey) => {
    const current = getCurrent();
    if (!current) return;
    if (codexCompatibilityInput(current.binaryPath, current.envOverrides).cacheKey === cacheKey) {
      listener();
    }
  });
}
