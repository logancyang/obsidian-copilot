import { logWarn } from "@/logger";
import { mergePath } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

const MARKER = "__COPILOT_LOGIN_SHELL_PATH__";
const LOGIN_SHELL_TIMEOUT_MS = 10_000;

let resolved: Promise<string> | null = null;

// Obsidian opened from the Dock gets launchd's minimal PATH, and Claude Code pins its shell to the
// PATH it was given, so agents miss commands the user's terminal finds.
// https://github.com/logancyang/obsidian-copilot/issues/4096
export function agentShellPath(): Promise<string> {
  resolved ??= readLoginShellPath().then((loginPath) =>
    mergePath(loginPath?.split(":") ?? [], process.env.PATH)
  );
  return resolved;
}

async function readLoginShellPath(): Promise<string | null> {
  if (process.platform === "win32") return null;
  const os = requireNodeModule<typeof import("node:os")>("os");
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  let shell: string | null = null;
  try {
    shell = process.env.SHELL || os.userInfo().shell;
    if (!shell) return null;
    const { stdout } = await promisify(execFile)(
      shell,
      ["-i", "-l", "-c", `echo ${MARKER}; printenv PATH; echo ${MARKER}`],
      { timeout: LOGIN_SHELL_TIMEOUT_MS }
    );
    return stdout.split(MARKER)[1]?.trim() || null;
  } catch (err) {
    logWarn(`[AgentMode] could not read the PATH from login shell ${shell}`, err);
    return null;
  }
}
