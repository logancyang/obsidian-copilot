import type { ObsidianCliProcessResult } from "./ObsidianCliClient";

/**
 * Build a readable error string from CLI process output.
 *
 * Priority: stderr → ENOENT → errorCode → exitCode → fallback.
 *
 * @param stderr - Standard error payload.
 * @param exitCode - Numeric process exit code when available.
 * @param errorCode - Process error code from runtime.
 * @param attemptedBinaries - Binaries that were attempted.
 * @returns User-facing error summary.
 */
export function formatCliFailureMessage(
  stderr: string,
  exitCode: number | null,
  errorCode: string | number | null,
  attemptedBinaries: string[]
): string {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return trimmedStderr;
  }

  if (errorCode === "ENOENT") {
    const attempted = attemptedBinaries.length > 0 ? attemptedBinaries.join(", ") : "unknown";
    return `CLI binary not found. Tried: ${attempted}. Ensure Obsidian CLI is installed or set OBSIDIAN_CLI_BINARY/OBSIDIAN_CLI_PATH.`;
  }

  if (errorCode !== null) {
    return `Obsidian CLI failed with error code ${String(errorCode)}`;
  }

  if (exitCode !== null) {
    return `Obsidian CLI failed with exit code ${exitCode}`;
  }

  return "Obsidian CLI command failed for an unknown reason";
}

/**
 * Throw a standardized error from a failed CLI result.
 *
 * @param result - Failed CLI process result.
 */
export function throwCliFailure(result: ObsidianCliProcessResult): never {
  throw new Error(
    formatCliFailureMessage(
      result.stderr,
      result.exitCode,
      result.errorCode,
      result.attemptedBinaries
    )
  );
}
