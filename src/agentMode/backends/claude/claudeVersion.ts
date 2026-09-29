import { compareSemver } from "@/utils/semver";
import { requireNodeModule } from "@/utils/desktopRuntime";

const VERSION_TIMEOUT_MS = 10_000;

export const CLAUDE_MIN_VERSION = "2.1.206";

export type ClaudeVersionRunner = (
  claudePath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number }
) => Promise<{ stdout: string }>;

async function runClaudeVersion(
  claudePath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number }
): Promise<{ stdout: string }> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  return promisify(execFile)(claudePath, args, options);
}

function buildVersionInvocation(
  claudePath: string,
  env: NodeJS.ProcessEnv
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (!/\.[cm]?js$/i.test(claudePath)) {
    return { command: claudePath, args: ["--version"], env };
  }
  return {
    command: process.execPath,
    args: [claudePath, "--version"],
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

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

export async function probeClaudeVersion(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  run: ClaudeVersionRunner = runClaudeVersion
): Promise<ClaudeVersionCompatibility> {
  const invocation = buildVersionInvocation(claudePath, env);
  let stdout: string;
  try {
    ({ stdout } = await run(invocation.command, invocation.args, {
      env: invocation.env,
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

export async function assertClaudeVersionSupported(
  claudePath: string,
  env: NodeJS.ProcessEnv,
  run: ClaudeVersionRunner = runClaudeVersion
): Promise<void> {
  const compatibility = await probeClaudeVersion(claudePath, env, run);
  if (compatibility.kind === "incompatible") throw new Error(compatibility.message);
}
