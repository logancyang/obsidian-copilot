import { requireNodeModule } from "@/utils/desktopRuntime";

/**
 * Releases executable file locks before removing a Windows managed installation.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/379
 * Processes outside that directory are left running. Other platforms can unlink
 * running executables and require no process termination.
 * @param directory - Installation directory whose executable files will be removed.
 * @param platform - Operating system performing the removal.
 */
export async function stopWindowsProcessesInDirectory(
  directory: string,
  platform = process.platform
): Promise<void> {
  // An open native executable prevents Windows unlink even when the custom
  // selection is already saved. Resolve process identity by directory, never name.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (platform !== "win32") return;
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const script = `
$ErrorActionPreference = 'Stop'
$directory = [IO.Path]::GetFullPath('${directory.replace(/'/g, "''")}').TrimEnd('\\') + '\\'
$matching = @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase) })
foreach ($running in $matching) {
  try {
    if (!$running.HasExited) {
      $running.Kill()
      if (!$running.WaitForExit(10000)) { throw 'Managed process did not exit.' }
    }
  } catch {
    if (!$running.HasExited) { throw }
  } finally {
    $running.Dispose()
  }
}
`;
  await new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 30_000 },
      (error) => {
        if (error)
          reject(new Error("Could not stop processes using the managed download directory."));
        else resolve();
      }
    );
  });
}
