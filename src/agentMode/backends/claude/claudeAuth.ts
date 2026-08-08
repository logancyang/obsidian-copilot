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
import { execFile, spawn } from "node:child_process";
import { type Readable } from "node:stream";
import { promisify } from "node:util";
import { logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";

const execFileAsync = promisify(execFile);

/** `claude auth status` is a quick local read; cap it so a wedged CLI can't hang the UI. */
const STATUS_TIMEOUT_MS = 10_000;

/** First http(s) URL on a line — the OAuth page the CLI prints as a browser fallback. */
const URL_PATTERN = /\bhttps?:\/\/[^\s'"]+/;

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

export interface SignInHandlers {
  /** Called once with the OAuth URL the CLI prints (browser-open fallback). */
  onUrl?: (url: string) => void;
  /** Called per stdout/stderr line for progress display. */
  onLine?: (line: string) => void;
}

export interface ClaudeSignInController {
  /** Resolves with the post-login status once the CLI exits. Never rejects. */
  done: Promise<ClaudeAuthStatus>;
  /** Terminate the login subprocess (SIGTERM) — for teardown. */
  cancel: () => void;
}

/**
 * Run `claude auth login`. The CLI opens the system browser itself and runs a
 * loopback callback listener; we stream its output (so callers can show the
 * printed URL as a clickable fallback) and, on exit, re-read `auth status` as
 * the source of truth. stdin is closed so a CLI build that would otherwise wait
 * for a pasted code fails fast instead of hanging.
 */
export function signInToClaude(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  handlers: SignInHandlers = {}
): ClaudeSignInController {
  logInfo("[AgentMode] spawning claude auth login");
  const child = spawn(claudePath, ["auth", "login", "--claudeai"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let urlSeen = false;
  const handleLine = (line: string): void => {
    handlers.onLine?.(line);
    if (urlSeen) return;
    const match = URL_PATTERN.exec(line);
    if (match) {
      urlSeen = true;
      handlers.onUrl?.(match[0]);
    }
  };
  attachLineReader(child.stdout, handleLine);
  attachLineReader(child.stderr, handleLine);

  const done = new Promise<ClaudeAuthStatus>((resolve) => {
    child.on("error", (err) => {
      logWarn("[AgentMode] claude auth login spawn error", err2String(err));
      resolve({ loggedIn: false });
    });
    child.on("close", () => {
      void getClaudeAuthStatus(claudePath, env).then(resolve, () => resolve({ loggedIn: false }));
    });
  });

  return {
    done,
    cancel: () => {
      try {
        child.kill("SIGTERM");
      } catch (e) {
        logWarn("[AgentMode] claude auth login kill failed", err2String(e));
      }
    },
  };
}

/** Emit complete (newline-delimited) lines from a piped child stream. */
function attachLineReader(stream: Readable | null, onLine: (line: string) => void): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) onLine(line);
      idx = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    const rest = buffer.trim();
    if (rest.length > 0) onLine(rest);
  });
}
