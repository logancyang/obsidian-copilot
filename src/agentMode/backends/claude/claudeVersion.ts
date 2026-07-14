import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compareSemver } from "@/utils/semver";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;

export const CLAUDE_MIN_VERSION = "2.1.206";

export type ClaudeVersionRunner = (
  claudePath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number }
) => Promise<{ stdout: string }>;

export function parseClaudeVersionOutput(stdout: string): string | null {
  return stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

export type ClaudeVersionCompatibility =
  | { kind: "supported"; version: string }
  | {
      kind: "incompatible";
      currentVersion: string;
      minVersion: string;
      message: string;
    };

/**
 * Establishes whether the selected Claude Code runtime satisfies the protocol contract the plugin depends on.
 * @param claudePath - The selected Claude Code executable to inspect.
 * @param env - The runtime environment that should govern the compatibility check.
 * @param run - The command runner used to obtain version information.
 */
export async function probeClaudeVersion(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  run: ClaudeVersionRunner = execFileAsync
): Promise<ClaudeVersionCompatibility> {
  let stdout: string;
  try {
    ({ stdout } = await run(claudePath, ["--version"], {
      env,
      timeout: VERSION_TIMEOUT_MS,
    }));
  } catch {
    throw new Error(
      `Could not verify the installed Claude Code version. Copilot requires Claude Code ${CLAUDE_MIN_VERSION} or newer.`
    );
  }

  const version = parseClaudeVersionOutput(stdout);
  if (!version) {
    throw new Error(
      `Could not read the installed Claude Code version. Copilot requires Claude Code ${CLAUDE_MIN_VERSION} or newer.`
    );
  }
  if (compareSemver(version, CLAUDE_MIN_VERSION) < 0) {
    return {
      kind: "incompatible",
      currentVersion: version,
      minVersion: CLAUDE_MIN_VERSION,
      message: `Claude Code ${version} is not supported. Copilot requires Claude Code ${CLAUDE_MIN_VERSION} or newer.`,
    };
  }
  return { kind: "supported", version };
}

/**
 * Enforces compatibility at the session boundary so unsupported runtimes fail with an actionable error.
 * @param claudePath - The selected Claude Code executable that will back the session.
 * @param env - The runtime environment the session will inherit.
 * @param run - The command runner used to verify the selected runtime.
 */
export async function assertClaudeVersionSupported(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  run: ClaudeVersionRunner = execFileAsync
): Promise<void> {
  const compatibility = await probeClaudeVersion(claudePath, env, run);
  if (compatibility.kind === "incompatible") throw new Error(compatibility.message);
}
