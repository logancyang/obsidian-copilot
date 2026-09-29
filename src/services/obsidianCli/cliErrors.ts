import type { ObsidianCliProcessResult } from "./ObsidianCliClient";

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
