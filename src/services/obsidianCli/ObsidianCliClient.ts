import { Platform } from "obsidian";

/**
 * Default CLI executable name registered by Obsidian.
 */
export const DEFAULT_OBSIDIAN_CLI_BINARY = "obsidian";

/**
 * Known desktop fallback paths for Obsidian CLI on macOS installs.
 */
const OBSIDIAN_CLI_MACOS_FALLBACK_BINARIES = [
  "/Applications/Obsidian.app/Contents/MacOS/obsidian",
  "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
];

/**
 * Default timeout for CLI command execution.
 */
export const DEFAULT_OBSIDIAN_CLI_TIMEOUT_MS = 15_000;

/**
 * Default maximum process output buffer (1 MB).
 */
export const DEFAULT_OBSIDIAN_CLI_MAX_BUFFER_BYTES = 1_048_576;

/**
 * Supported primitive parameter value types for CLI serialization.
 */
export type ObsidianCliParamValue = string | number | boolean | null | undefined;

/**
 * Shape of a command invocation for the Obsidian CLI.
 */
export interface ObsidianCliInvocation {
  command: string;
  vault?: string;
  params?: Record<string, ObsidianCliParamValue>;
  timeoutMs?: number;
  maxBufferBytes?: number;
  binary?: string;
}

/**
 * Result object returned from Obsidian CLI process execution.
 */
export interface ObsidianCliProcessResult {
  command: string;
  args: string[];
  binary: string;
  attemptedBinaries: string[];
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorCode: string | number | null;
  signal: string | null;
  durationMs: number;
}

/**
 * Callback signature used by Node's `execFile`.
 */
type ExecFileCallback = (error: ExecFileError | null, stdout: string, stderr: string) => void;

/**
 * Minimal shape of process execution error from `execFile`.
 */
interface ExecFileError extends Error {
  code?: string | number | null;
  signal?: string | null;
}

/**
 * Minimal options shape supported by `execFile`.
 */
interface ExecFileOptions {
  timeout?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
}

/**
 * Minimal `execFile` function contract used in this module.
 */
type ExecFileFn = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  callback: ExecFileCallback
) => void;

/**
 * Minimal shape of the required child_process module.
 */
interface ChildProcessModule {
  execFile?: ExecFileFn;
}

/**
 * Minimal global shape that may expose Node's `require` in the desktop renderer.
 */
interface RequireContainer {
  require?: (id: string) => unknown;
}

/**
 * Minimal global shape that may expose `process.env`.
 */
interface ProcessContainer {
  process?: {
    env?: Record<string, string | undefined>;
  };
}

/**
 * Check whether the current runtime is desktop Obsidian.
 * Supports both `isDesktopApp` and legacy `isDesktop` flags for compatibility.
 *
 * @returns True when running in desktop runtime.
 */
function isDesktopRuntime(): boolean {
  const platform = Platform as unknown as { isDesktopApp?: boolean; isDesktop?: boolean };
  return Boolean(platform.isDesktopApp ?? platform.isDesktop);
}

/**
 * Resolve `require` from the desktop runtime.
 *
 * @returns Runtime `require` function.
 * @throws If `require` is not available.
 */
function getRuntimeRequire(): (id: string) => unknown {
  const container = globalThis as unknown as RequireContainer;
  if (typeof container.require !== "function") {
    throw new Error(
      "Node require is unavailable in this runtime. Obsidian CLI commands require the desktop app."
    );
  }
  return container.require;
}

/**
 * Resolve Node's `execFile` function from `child_process`.
 *
 * @returns `execFile` function.
 * @throws If `child_process.execFile` cannot be resolved.
 */
function getExecFileFunction(): ExecFileFn {
  const runtimeRequire = getRuntimeRequire();
  const childProcessModule = runtimeRequire("child_process") as ChildProcessModule;
  if (typeof childProcessModule.execFile !== "function") {
    throw new Error("Failed to resolve child_process.execFile");
  }
  return childProcessModule.execFile;
}

/**
 * Normalize parameter values for the CLI's text-based parser.
 * Converts literal newlines/tabs to escaped sequences.
 *
 * @param value - Raw parameter value.
 * @returns CLI-safe parameter string.
 */
function normalizeCliParameterValue(value: string): string {
  return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

/**
 * Read optional CLI binary overrides from environment variables.
 *
 * @returns Ordered non-empty binary candidates from environment.
 */
function getCliBinaryCandidatesFromEnv(): string[] {
  const container = globalThis as unknown as ProcessContainer;
  const env = container.process?.env;
  if (!env) {
    return [];
  }

  const envCandidates = [env.OBSIDIAN_CLI_BINARY, env.OBSIDIAN_CLI_PATH];
  return envCandidates.map((candidate) => candidate?.trim() || "").filter(Boolean);
}

/**
 * Build a deduplicated ordered list of executable candidates.
 *
 * @param explicitBinary - Explicit binary override provided by caller.
 * @returns Ordered list of binary candidates to attempt.
 */
function resolveBinaryCandidates(explicitBinary?: string): string[] {
  const explicit = explicitBinary?.trim();
  if (explicit) {
    return [explicit];
  }

  const candidates = [
    DEFAULT_OBSIDIAN_CLI_BINARY,
    ...getCliBinaryCandidatesFromEnv(),
    ...OBSIDIAN_CLI_MACOS_FALLBACK_BINARIES,
  ];

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

/**
 * Build Obsidian CLI argument list from invocation data.
 * Keeps `vault=<name>` first when provided, per CLI docs.
 *
 * @param invocation - Invocation payload.
 * @returns Ordered CLI arguments.
 */
export function buildObsidianCliArgs(invocation: ObsidianCliInvocation): string[] {
  const args: string[] = [];

  const trimmedVault = invocation.vault?.trim();
  if (trimmedVault) {
    args.push(`vault=${trimmedVault}`);
  }

  args.push(invocation.command);

  const entries = Object.entries(invocation.params || {});
  entries.sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "boolean") {
      if (value) {
        args.push(key);
      }
      continue;
    }

    args.push(`${key}=${normalizeCliParameterValue(String(value))}`);
  }

  return args;
}

/**
 * Normalize process exit code from `execFile` error payload.
 *
 * @param code - Error code from process callback.
 * @returns Numeric exit code when available.
 */
function toExitCode(code: string | number | null | undefined): number | null {
  return typeof code === "number" ? code : null;
}

/**
 * Execute the CLI once with a specific binary candidate.
 *
 * @param execFile - Process execution function.
 * @param command - Logical command being executed.
 * @param binary - Binary candidate path/name.
 * @param args - CLI arguments.
 * @param timeoutMs - Timeout in milliseconds.
 * @param maxBufferBytes - Maximum process output buffer in bytes.
 * @param attemptedBinaries - Current list of attempted binaries.
 * @returns Structured process result.
 */
async function executeOnce(
  execFile: ExecFileFn,
  command: string,
  binary: string,
  args: string[],
  timeoutMs: number,
  maxBufferBytes: number,
  attemptedBinaries: string[]
): Promise<ObsidianCliProcessResult> {
  const startedAt = Date.now();

  return await new Promise<ObsidianCliProcessResult>((resolve) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        if (error) {
          resolve({
            command,
            args,
            binary,
            attemptedBinaries: [...attemptedBinaries],
            ok: false,
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode: toExitCode(error.code),
            errorCode: error.code ?? null,
            signal: error.signal ?? null,
            durationMs,
          });
          return;
        }

        resolve({
          command,
          args,
          binary,
          attemptedBinaries: [...attemptedBinaries],
          ok: true,
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: 0,
          errorCode: null,
          signal: null,
          durationMs,
        });
      }
    );
  });
}

/**
 * Execute a single Obsidian CLI command.
 *
 * @param invocation - Command invocation payload.
 * @returns Structured process result including stdout/stderr and execution metadata.
 * @throws If runtime is unsupported or invocation is invalid.
 */
export async function runObsidianCliCommand(
  invocation: ObsidianCliInvocation
): Promise<ObsidianCliProcessResult> {
  const command = invocation.command?.trim();
  if (!command) {
    throw new Error("Obsidian CLI command is required");
  }

  if (!isDesktopRuntime()) {
    throw new Error("Obsidian CLI commands are only supported in desktop Obsidian.");
  }

  const args = buildObsidianCliArgs({ ...invocation, command });
  const timeoutMs = invocation.timeoutMs ?? DEFAULT_OBSIDIAN_CLI_TIMEOUT_MS;
  const maxBufferBytes = invocation.maxBufferBytes ?? DEFAULT_OBSIDIAN_CLI_MAX_BUFFER_BYTES;
  const execFile = getExecFileFunction();
  const candidateBinaries = resolveBinaryCandidates(invocation.binary);
  const attemptedBinaries: string[] = [];

  let lastResult: ObsidianCliProcessResult | null = null;
  for (const candidateBinary of candidateBinaries) {
    attemptedBinaries.push(candidateBinary);
    const result = await executeOnce(
      execFile,
      command,
      candidateBinary,
      args,
      timeoutMs,
      maxBufferBytes,
      attemptedBinaries
    );
    lastResult = result;

    if (result.ok) {
      return result;
    }

    if (result.errorCode !== "ENOENT") {
      return result;
    }
  }

  if (lastResult) {
    return lastResult;
  }

  throw new Error("Obsidian CLI execution failed before process spawn.");
}

/**
 * Read the current daily note content through Obsidian CLI (`daily:read`).
 *
 * @param vault - Optional vault name target.
 * @returns CLI process result for the `daily:read` command.
 */
export async function runDailyReadCommand(vault?: string): Promise<ObsidianCliProcessResult> {
  return await runObsidianCliCommand({
    command: "daily:read",
    vault,
  });
}

/**
 * Read a random note through Obsidian CLI (`random:read`).
 *
 * @param vault - Optional vault name target.
 * @returns CLI process result for the `random:read` command.
 */
export async function runRandomReadCommand(vault?: string): Promise<ObsidianCliProcessResult> {
  return await runObsidianCliCommand({
    command: "random:read",
    vault,
  });
}
