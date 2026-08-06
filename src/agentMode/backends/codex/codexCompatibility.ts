import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import {
  CompatibilityStore,
  type CompatibilityRefreshOptions,
  type CompatibilityStoreInput,
} from "@/agentMode/backends/shared/compatibilityStore";
import type { InstallState } from "@/agentMode/session/types";
import { codexAcpInvocation, type CodexAcpShimReader } from "./codexBinaryResolver";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;
const MAINTAINED_ADAPTER_VERSION =
  /^@agentclientprotocol\/codex-acp\s+\d+\.\d+\.\d+(?:[-+][^\s]+)?\s*$/;

export const CODEX_REMOVE_LEGACY_COMMAND = "npm uninstall -g @zed-industries/codex-acp";
const CODEX_NPM_INSTALL_COMMAND = "npm install -g @agentclientprotocol/codex-acp";
const CODEX_WINDOWS_INSTALL_COMMAND =
  "irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/78723aec5ebe3a1fa271ebf437511550a97f3266/docs/install-codex-agent-mode-windows.ps1 | iex";

export interface CodexInstallGuidance {
  installCommand: string;
  removeLegacyCommand: string | null;
  updateMessage: string;
}

/**
 * Returns installation guidance that preserves the host environment where Obsidian runs.
 * @param platform - The host platform that determines whether native Windows bootstrapping is needed.
 */
export function getCodexInstallGuidance(
  platform: NodeJS.Platform = process.platform
): CodexInstallGuidance {
  if (platform === "win32") {
    return {
      installCommand: CODEX_WINDOWS_INSTALL_COMMAND,
      removeLegacyCommand: null,
      updateMessage:
        "Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Run the Windows PowerShell install command, then select the new codex-acp.cmd path.",
    };
  }

  return {
    installCommand: CODEX_NPM_INSTALL_COMMAND,
    removeLegacyCommand: CODEX_REMOVE_LEGACY_COMMAND,
    updateMessage: `Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Run ${CODEX_REMOVE_LEGACY_COMMAND}, then ${CODEX_NPM_INSTALL_COMMAND}, and select the new codex-acp path.`,
  };
}

const DEFAULT_INSTALL_GUIDANCE = getCodexInstallGuidance();
export const CODEX_INSTALL_COMMAND = DEFAULT_INSTALL_GUIDANCE.installCommand;
export const CODEX_ACP_UPDATE_MESSAGE = DEFAULT_INSTALL_GUIDANCE.updateMessage;

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
    env: buildCodexEnvironment(binaryPath, process.env, envOverrides),
  };
}

/**
 * Builds a Codex adapter environment without duplicate Windows PATH keys.
 * @param binaryPath - The selected adapter path used to augment sparse GUI environments.
 * @param baseEnv - The process environment inherited by the plugin.
 * @param envOverrides - User-configured Codex environment overrides.
 * @param platform - The device platform that determines environment-key casing.
 */
export function buildCodexEnvironment(
  binaryPath: string,
  baseEnv: NodeJS.ProcessEnv,
  envOverrides: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const basePathEntry = Object.entries(baseEnv).find(([key]) => key.toLowerCase() === "path");
  const augmentedPath = augmentPathForNodeShebang(binaryPath, basePathEntry?.[1]);

  if (platform !== "win32") {
    return { ...env, PATH: augmentedPath, ...envOverrides };
  }

  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  let effectivePath = augmentedPath;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (key.toLowerCase() === "path") {
      effectivePath = value;
    } else {
      env[key] = value;
    }
  }
  env.PATH = effectivePath;
  return env;
}

/**
 * Positively identifies the maintained Codex ACP adapter without starting an ACP session.
 * @param binaryPath - The selected executable whose package identity should be verified.
 * @param run - The command runner used to read the executable's local identity.
 * @param platform - The device platform used to translate Windows npm command shims.
 * @param env - The effective environment the adapter process will inherit.
 * @param readShim - Reads a Windows command shim so its encoded package target can be resolved.
 */
export async function probeCodexAcpCompatibility(
  binaryPath: string,
  run: CodexVersionRunner = execFileAsync,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
  },
  readShim?: CodexAcpShimReader
): Promise<InstallState> {
  try {
    const invocation = codexAcpInvocation(binaryPath, platform, readShim);
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
  return { kind: "error", message: getCodexInstallGuidance(platform).updateMessage };
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
