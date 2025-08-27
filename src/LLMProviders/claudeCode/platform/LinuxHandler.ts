/**
 * LinuxHandler - Linux-specific Claude CLI handling
 *
 * Handles Linux-specific process spawning, package manager paths,
 * and distribution-specific installation locations.
 */

import { SpawnOptions } from "child_process";

export class LinuxHandler {
  /**
   * Get Linux-specific spawn options
   */
  getSpawnOptions(): SpawnOptions {
    // TODO: Implement in Story 6.2
    return {
      env: process.env,
    };
  }

  /**
   * Get common Linux installation paths
   */
  getCommonPaths(): string[] {
    // TODO: Implement in Story 6.2
    return [
      "claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      "/bin/claude",
      "/snap/bin/claude",
      "/var/lib/flatpak/exports/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
    ];
  }

  /**
   * Handle Linux-specific process signals
   */
  handleSignals(process: any): void {
    // TODO: Implement in Story 6.2
    // Linux process signal handling
  }

  /**
   * Check for snap installation
   */
  async checkSnap(): Promise<string | null> {
    // TODO: Implement in Story 6.2
    return null;
  }

  /**
   * Check for flatpak installation
   */
  async checkFlatpak(): Promise<string | null> {
    // TODO: Implement in Story 6.2
    return null;
  }

  /**
   * Handle permission issues common on Linux
   */
  checkPermissions(path: string): Promise<boolean> {
    // TODO: Implement in Story 6.2
    return Promise.resolve(false);
  }
}
