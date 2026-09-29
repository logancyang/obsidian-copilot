import { Platform } from "obsidian";

const DEFAULT_OBSIDIAN_CLI_BINARY = "obsidian";

const OBSIDIAN_CLI_MACOS_FALLBACK_BINARIES = [
  "/Applications/Obsidian.app/Contents/MacOS/obsidian",
  "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
];

const DEFAULT_OBSIDIAN_CLI_TIMEOUT_MS = 15_000;

const DEFAULT_OBSIDIAN_CLI_MAX_BUFFER_BYTES = 1_048_576;

export type ObsidianCliParamValue = string | number | boolean | null | undefined;

export interface ObsidianCliInvocation {
  command: string;
  vault?: string;
  params?: Record<string, ObsidianCliParamValue>;
  timeoutMs?: number;
  maxBufferBytes?: number;
  binary?: string;
}

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

type ExecFileCallback = (error: ExecFileError | null, stdout: string, stderr: string) => void;

interface ExecFileError extends Error {
  code?: string | number | null;
  signal?: string | null;
}

interface ExecFileOptions {
  timeout?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
}

type ExecFileFn = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  callback: ExecFileCallback
) => void;

interface ChildProcessModule {
  execFile?: ExecFileFn;
}

interface RequireContainer {
  require?: (id: string) => unknown;
}

interface ProcessContainer {
  process?: {
    env?: Record<string, string | undefined>;
  };
}

export function isDesktopRuntime(): boolean {
  const platform = Platform as unknown as { isDesktopApp?: boolean; isDesktop?: boolean };
  return Boolean(platform.isDesktopApp ?? platform.isDesktop);
}

function getRuntimeRequire(): (id: string) => unknown {
  const container = window as unknown as RequireContainer;
  if (typeof container.require !== "function") {
    throw new Error(
      "Node require is unavailable in this runtime. Obsidian CLI commands require the desktop app."
    );
  }
  return container.require;
}

function getExecFileFunction(): ExecFileFn {
  const runtimeRequire = getRuntimeRequire();
  const childProcessModule = runtimeRequire("child_process") as ChildProcessModule;
  if (typeof childProcessModule.execFile !== "function") {
    throw new Error("Failed to resolve child_process.execFile");
  }
  return childProcessModule.execFile;
}

function normalizeCliParameterValue(value: string): string {
  return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function getCliBinaryCandidatesFromEnv(): string[] {
  const container = window as unknown as ProcessContainer;
  const env = container.process?.env;
  if (!env) {
    return [];
  }

  const envCandidates = [env.OBSIDIAN_CLI_BINARY, env.OBSIDIAN_CLI_PATH];
  return envCandidates.map((candidate) => candidate?.trim() || "").filter(Boolean);
}

function resolveBinaryCandidates(explicitBinary?: string): string[] {
  const explicit = explicitBinary?.trim();
  if (explicit) {
    return [explicit];
  }

  const candidates = [
    ...getCliBinaryCandidatesFromEnv(),
    DEFAULT_OBSIDIAN_CLI_BINARY,
    ...OBSIDIAN_CLI_MACOS_FALLBACK_BINARIES,
  ];

  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

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

function toExitCode(code: string | number | null | undefined): number | null {
  return typeof code === "number" ? code : null;
}

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

export async function runDailyReadCommand(vault?: string): Promise<ObsidianCliProcessResult> {
  return await runObsidianCliCommand({
    command: "daily:read",
    vault,
  });
}

export async function runRandomReadCommand(vault?: string): Promise<ObsidianCliProcessResult> {
  return await runObsidianCliCommand({
    command: "random:read",
    vault,
  });
}
