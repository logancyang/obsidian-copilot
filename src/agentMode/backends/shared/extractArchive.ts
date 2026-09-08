import { requireNodeModule } from "@/utils/desktopRuntime";
import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";

interface ExtractionOptions {
  signal?: AbortSignal;
  stripComponents?: number;
}

/**
 * Extracts a release using system tar, with actionable errors when it is unavailable.
 * Callers must use tar archives on Linux; macOS and Windows bsdtar also support ZIP.
 * @param archivePath - Downloaded release archive.
 * @param destDir - Existing staging directory owned by the installation.
 * @param options - Cancellation and archive wrapper directories to remove.
 */
export async function extractArchive(
  archivePath: string,
  destDir: string,
  options: ExtractionOptions = {}
): Promise<void> {
  const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const args = ["-xf", archivePath, "-C", destDir];
  // Full runtime bundles have a wrapper directory; their installed layout must start below it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (options.stripComponents) args.push(`--strip-components=${options.stripComponents}`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    let stderr = "";
    let error: NodeJS.ErrnoException | undefined;
    proc.stderr.on("data", (data: Uint8Array) => {
      stderr += Buffer.from(data).toString();
    });
    proc.on("error", (cause: NodeJS.ErrnoException) => {
      error = cause;
    });
    // Wait for tar to exit before the installation cleans up its stage after cancellation.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
    proc.on("close", (code) => {
      if (options.signal?.aborted) reject(new ManagedInstallAbortError());
      else if (error?.code === "ENOENT")
        reject(
          new Error(
            "`tar` was not found on PATH. macOS/Linux ship it by default; on Windows you need 10 1803+ (which ships `tar.exe`/bsdtar) or to install bsdtar manually."
          )
        );
      else if (error) reject(new Error(`Failed to launch tar: ${error.message}`));
      else if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}
