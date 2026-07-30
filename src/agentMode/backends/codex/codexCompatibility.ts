import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import type { InstallState } from "@/agentMode/session/types";
import { codexAcpInvocation } from "./codexBinaryResolver";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;
const MAINTAINED_ADAPTER_VERSION =
  /^@agentclientprotocol\/codex-acp\s+\d+\.\d+\.\d+(?:[-+][^\s]+)?\s*$/;
const CHECKING_STATE: InstallState = Object.freeze({ kind: "checking", source: "custom" });

export const CODEX_ACP_UPDATE_MESSAGE =
  "Copilot could not verify this as the maintained Codex ACP adapter. The superseded adapter cannot provide current Codex models. Update with: npm install -g @agentclientprotocol/codex-acp, then select the new codex-acp path.";

export type CodexVersionRunner = (
  binaryPath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number }
) => Promise<{ stdout: string }>;

interface RefreshOptions {
  force?: boolean;
  run?: CodexVersionRunner;
}

type Listener = () => void;
const states = new Map<string, InstallState>();
const inflight = new Map<string, Promise<InstallState>>();
const listeners = new Set<Listener>();

/**
 * Positively identifies the maintained Codex ACP adapter without starting an ACP session.
 * @param binaryPath - The selected executable whose package identity should be verified.
 * @param run - The command runner used to read the executable's local identity.
 * @param platform - The device platform used to translate Windows npm command shims.
 */
export async function probeCodexAcpCompatibility(
  binaryPath: string,
  run: CodexVersionRunner = execFileAsync,
  platform: NodeJS.Platform = process.platform
): Promise<InstallState> {
  try {
    const invocation = codexAcpInvocation(binaryPath, platform);
    const { stdout } = await run(invocation.command, [...invocation.args, "--version"], {
      env: {
        ...process.env,
        PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
      },
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

/**
 * Gives synchronous consumers the latest result for a selected executable.
 * @param binaryPath - The selected executable whose compatibility should be read.
 */
export function getCodexCompatibility(binaryPath: string): InstallState {
  return states.get(binaryPath) ?? CHECKING_STATE;
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
  const running = inflight.get(binaryPath);
  if (running) return running;

  const cached = states.get(binaryPath);
  if (!options.force && cached && cached.kind !== "checking") return Promise.resolve(cached);

  publish(binaryPath, CHECKING_STATE);
  const promise = probeCodexAcpCompatibility(binaryPath, options.run)
    .then((state) => {
      publish(binaryPath, state);
      return state;
    })
    .finally(() => inflight.delete(binaryPath));

  inflight.set(binaryPath, promise);
  return promise;
}

/**
 * Notifies a consumer whenever any selected path changes compatibility state.
 * @param listener - The consumer to notify after checking and settled transitions.
 */
export function subscribeCodexCompatibility(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(binaryPath: string, state: InstallState): void {
  states.set(binaryPath, state);
  for (const listener of listeners) listener();
}
