import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import { requireNodeModule } from "@/utils/desktopRuntime";

import {
  signInWithCli,
  signOutWithCli,
  type SignInHandlers,
  type CliSignInController,
} from "@/agentMode/backends/shared/cliSignIn";

const STATUS_TIMEOUT_MS = 10_000;

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  label?: string;
}

interface ClaudeAuthStatusJson {
  loggedIn?: boolean;
  email?: string;
  subscriptionType?: string;
  authMethod?: string;
  apiProvider?: string;
}

export function parseClaudeAuthStatusOutput(stdout: string): ClaudeAuthStatus {
  try {
    return parseVerifiedClaudeAuthStatus(stdout);
  } catch {
    return { loggedIn: false };
  }
}

function parseVerifiedClaudeAuthStatus(stdout: string): ClaudeAuthStatus {
  const parsed = JSON.parse(stdout) as ClaudeAuthStatusJson | null;
  // Malformed output cannot establish that credentials were removed during logout.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (typeof parsed?.loggedIn !== "boolean")
    throw new Error("Unable to verify Claude authentication status.");
  if (!parsed.loggedIn) return { loggedIn: false };
  return { loggedIn: true, label: buildAccountLabel(parsed) };
}

function buildAccountLabel(s: ClaudeAuthStatusJson): string | undefined {
  const who = s.email ?? s.apiProvider;
  const detail = s.subscriptionType ?? s.authMethod;
  if (who && detail) return `${who} (${detail})`;
  return who ?? detail;
}

export async function getClaudeAuthStatus(
  claudePath: string,
  env: NodeJS.ProcessEnv
): Promise<ClaudeAuthStatus> {
  try {
    return await readClaudeAuthStatus(claudePath, env);
  } catch (e) {
    logWarn("[AgentMode] claude auth status failed", err2String(e));
    return { loggedIn: false };
  }
}

async function readClaudeAuthStatus(
  claudePath: string,
  env: NodeJS.ProcessEnv
): Promise<ClaudeAuthStatus> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  const execFileAsync = promisify(execFile);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(claudePath, ["auth", "status", "--json"], {
      timeout: STATUS_TIMEOUT_MS,
      env,
    }));
  } catch (e) {
    const error = e as { stdout?: unknown; killed?: boolean };
    // Some CLI versions report a signed-out status with a nonzero exit; a timed-out
    // process or missing JSON still cannot verify that logout removed credentials.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    if (error.killed || typeof error.stdout !== "string") throw e;
    stdout = error.stdout;
  }
  return parseVerifiedClaudeAuthStatus(stdout);
}

export type {
  SignInHandlers,
  CliSignInController as ClaudeSignInController,
} from "@/agentMode/backends/shared/cliSignIn";

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

export function signOutFromClaude(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  options?: { signal?: AbortSignal }
): Promise<ClaudeAuthStatus> {
  return signOutWithCli(
    claudePath,
    ["auth", "logout"],
    env,
    () => readClaudeAuthStatus(claudePath, env),
    options
  );
}
