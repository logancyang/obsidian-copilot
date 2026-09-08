import { requireNodeModule } from "@/utils/desktopRuntime";
import { logWarn } from "@/logger";
type Readable = import("node:stream").Readable;
export interface CliAuthStatus {
  loggedIn: boolean;
  label?: string;
}
export interface SignInHandlers {
  onUrl?: (url: string) => void;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Select the backend's authorization page when CLI output also contains diagnostic URLs. */
  acceptUrl?: (url: string) => boolean;
}
export interface CliSignInController {
  done: Promise<CliAuthStatus>;
  cancel: () => void;
}

/** Owns the browser-login subprocess used by Claude and Codex; credentials stay with their CLI.
 * @param command - Resolved adapter or CLI executable.
 * @param args - Backend-specific browser-login arguments.
 * @param env - Environment used by runtime sessions and status probes.
 * @param readStatus - Authoritative check after the login process exits.
 * @param handlers - Progress, browser fallback, and cancellation for the caller.
 */
export function signInWithCli(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  readStatus: () => Promise<CliAuthStatus>,
  handlers: SignInHandlers = {}
): CliSignInController {
  const { spawn, execFile } =
    requireNodeModule<typeof import("node:child_process")>("child_process");
  let child: ReturnType<typeof spawn>;
  let resolveDone: (status: CliAuthStatus) => void;
  const done = new Promise<CliAuthStatus>((resolve) => {
    resolveDone = resolve;
  });
  let cancelled = false;
  let settled = false;
  let exited = false;
  let closed = false;
  let treeStopped = true;
  const finish = (status: CliAuthStatus): void => {
    if (settled) return;
    settled = true;
    handlers.signal?.removeEventListener("abort", cancel);
    resolveDone(status);
  };
  const cancel = (): void => {
    if (settled || cancelled) return;
    cancelled = true;
    // The ACP CLI proxy does not forward signals. Stop its owned tree before allowing Retry.
    // A POSIX process group can outlive its leader while descendants retain the pipes.
    // Once those pipes close, cancellation must not signal a potentially reused identifier.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    if (!child?.pid || closed) {
      finish({ loggedIn: false });
      return;
    }
    try {
      if (process.platform === "win32") {
        // taskkill addresses a PID, not a group. After exit, await pipe closure instead
        // of targeting a PID that Windows may have reassigned.
        if (exited) return;
        treeStopped = false;
        execFile(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          (error) => {
            treeStopped = true;
            if (error) logWarn("[AgentMode] Login process-tree cancellation failed", error);
            if (closed) finish({ loggedIn: false });
          }
        );
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch (error) {
      logWarn("[AgentMode] Login cancellation failed", error);
    }
  };
  // Closing the initiating dialog or cancelling must never publish a late successful login.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (handlers.signal?.aborted) {
    cancel();
    return { done, cancel };
  }
  try {
    child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
  } catch {
    finish({ loggedIn: false });
    return { done, cancel };
  }
  handlers.signal?.addEventListener("abort", cancel, { once: true });
  let urlSeen = false;
  const handleLine = (line: string): void => {
    if (settled || cancelled) return;
    handlers.onLine?.(line);
    const match = /\bhttps?:\/\/[^\s'"]+/.exec(line);
    // Diagnostic links must not consume the fallback before the authorization URL arrives.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    if (!urlSeen && match && (!handlers.acceptUrl || handlers.acceptUrl(match[0]))) {
      urlSeen = true;
      handlers.onUrl?.(match[0]);
    }
  };
  attachLineReader(child.stdout, handleLine);
  attachLineReader(child.stderr, handleLine);
  child.on("error", () => finish({ loggedIn: false }));
  child.on("exit", () => {
    exited = true;
  });
  child.on("close", () => {
    exited = closed = true;
    if (cancelled) {
      if (treeStopped) finish({ loggedIn: false });
    } else if (!settled) void readStatus().then(finish, () => finish({ loggedIn: false }));
  });
  return { done, cancel };
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
