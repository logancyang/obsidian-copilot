/**
 * Sign-in state and OAuth sign-in for the user-installed `claude` CLI.
 *
 * The Claude Agent SDK exposes no public login API, so authentication is owned
 * entirely by the CLI: `claude auth status --json` is the source of truth (it
 * reflects an interactive OAuth login *and* env-based credentials like
 * `ANTHROPIC_API_KEY` / Bedrock / Vertex), and `claude auth login` runs the
 * OAuth flow — auto-opening the system browser, running a loopback callback
 * listener, and persisting credentials to the OS keychain. We never read or
 * write the token ourselves; we only invoke the CLI and re-read its status.
 */
import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import { requireNodeModule } from "@/utils/desktopRuntime";

import {
  signInWithCli,
  type SignInHandlers,
  type CliSignInController,
} from "@/agentMode/backends/shared/cliSignIn";

/** `claude auth status` is a quick local read; cap it so a wedged CLI can't hang the UI. */
const STATUS_TIMEOUT_MS = 10_000;

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  /** Display string for a signed-in account, e.g. `"zero@x.com (max)"`. */
  label?: string;
}

/** Subset of `claude auth status --json` we read. Extra fields are ignored. */
interface ClaudeAuthStatusJson {
  loggedIn?: boolean;
  email?: string;
  subscriptionType?: string;
  authMethod?: string;
  apiProvider?: string;
}

/**
 * Parse `claude auth status --json` output into a {@link ClaudeAuthStatus}.
 * Pure (no I/O) so the detection contract is unit-testable. Any non-JSON or
 * non-`loggedIn` payload resolves to signed-out.
 */
export function parseClaudeAuthStatusOutput(stdout: string): ClaudeAuthStatus {
  let parsed: ClaudeAuthStatusJson;
  try {
    parsed = JSON.parse(stdout) as ClaudeAuthStatusJson;
  } catch {
    return { loggedIn: false };
  }
  if (parsed.loggedIn !== true) return { loggedIn: false };
  return { loggedIn: true, label: buildAccountLabel(parsed) };
}

function buildAccountLabel(s: ClaudeAuthStatusJson): string | undefined {
  const who = s.email ?? s.apiProvider;
  const detail = s.subscriptionType ?? s.authMethod;
  if (who && detail) return `${who} (${detail})`;
  return who ?? detail;
}

/**
 * Probe the CLI's sign-in state. Treats any failure (spawn error, non-JSON
 * output, timeout) as signed-out so the UI surfaces the recoverable Sign-in CTA
 * rather than silently assuming auth. A non-zero exit still carries stdout on
 * some CLI builds, so we parse that before giving up.
 */
export async function getClaudeAuthStatus(
  claudePath: string,
  env: NodeJS.ProcessEnv
): Promise<ClaudeAuthStatus> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync(claudePath, ["auth", "status", "--json"], {
      timeout: STATUS_TIMEOUT_MS,
      env,
    });
    return parseClaudeAuthStatusOutput(stdout);
  } catch (e) {
    const stdout = (e as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.trim().length > 0) {
      return parseClaudeAuthStatusOutput(stdout);
    }
    logWarn("[AgentMode] claude auth status failed", err2String(e));
    return { loggedIn: false };
  }
}

export type {
  SignInHandlers,
  CliSignInController as ClaudeSignInController,
} from "@/agentMode/backends/shared/cliSignIn";

/** Runs Claude's browser sign-in and reads its authoritative status afterward.
 * @param claudePath - Resolved CLI used by Claude sessions.
 * @param env - Session environment, including profile overrides.
 * @param handlers - Browser fallback and cancellation callbacks.
 */
export function signInToClaude(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  handlers: SignInHandlers = {}
): CliSignInController {
  return signInWithCli(
    claudePath,
    ["auth", "login", "--claudeai"],
    env,
    () => getClaudeAuthStatus(claudePath, env),
    handlers
  );
}
