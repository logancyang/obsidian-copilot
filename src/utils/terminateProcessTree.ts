import { requireNodeModule } from "@/utils/desktopRuntime";

/**
 * Signals an owned tree; await close before deletion. https://github.com/Brevilabs/obsidian-copilot-private/issues/620
 * @param child - Owned child, spawned in a separate process group on POSIX platforms.
 * @param signal - Termination signal, or forced termination after the grace period.
 * @param platform - Operating system performing termination.
 */
export async function terminateProcessTree(
  child: import("node:child_process").ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  platform = process.platform
): Promise<void> {
  if (!child.pid) return;
  if (platform !== "win32") {
    process.kill(-child.pid, signal);
    return;
  }
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  await new Promise<void>((resolve, reject) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: 10_000 },
      (error) => (error ? reject(error) : resolve())
    );
  });
}
