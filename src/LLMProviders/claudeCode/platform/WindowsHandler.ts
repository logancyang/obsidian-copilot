/**
 * WindowsHandler - Windows-specific Claude CLI handling
 *
 * Handles Windows-specific process spawning, path resolution,
 * and platform quirks for Claude CLI execution.
 */

import { SpawnOptions } from "child_process";

export class WindowsHandler {
  /**
   * Get Windows-specific spawn options
   */
  getSpawnOptions(): SpawnOptions {
    // TODO: Implement in Story 6.2
    return {
      shell: true, // Windows often requires shell for proper execution
      windowsHide: true,
      env: process.env,
    };
  }

  /**
   * Get common Windows installation paths
   */
  getCommonPaths(): string[] {
    // TODO: Implement in Story 6.2
    return [
      "claude.exe",
      "C:\\Program Files\\Claude\\claude.exe",
      "C:\\Program Files (x86)\\Claude\\claude.exe",
      `${process.env.USERPROFILE}\\AppData\\Local\\Claude\\claude.exe`,
    ];
  }

  /**
   * Handle Windows-specific process signals
   */
  handleSignals(process: any): void {
    // TODO: Implement in Story 6.2
    // Windows process signal handling
  }

  /**
   * Resolve Windows path separators
   */
  resolvePath(path: string): string {
    // TODO: Implement in Story 6.2
    return path.replace(/\//g, "\\");
  }
}
