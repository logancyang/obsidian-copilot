/**
 * MacOSHandler - macOS-specific Claude CLI handling
 *
 * Handles macOS-specific process spawning, Homebrew detection,
 * and platform-specific execution requirements.
 */

import { SpawnOptions } from "child_process";

export class MacOSHandler {
  /**
   * Get macOS-specific spawn options
   */
  getSpawnOptions(): SpawnOptions {
    // TODO: Implement in Story 6.2
    return {
      env: {
        ...process.env,
        PATH: this.getExtendedPath(),
      },
    };
  }

  /**
   * Get common macOS installation paths including Homebrew
   */
  getCommonPaths(): string[] {
    // TODO: Implement in Story 6.2
    return [
      "claude",
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/Applications/Claude.app/Contents/MacOS/claude",
      `${process.env.HOME}/.local/bin/claude`,
    ];
  }

  /**
   * Get extended PATH including Homebrew locations
   */
  private getExtendedPath(): string {
    const currentPath = process.env.PATH || "";
    const additionalPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];

    return [currentPath, ...additionalPaths].join(":");
  }

  /**
   * Handle macOS-specific process signals
   */
  handleSignals(process: any): void {
    // TODO: Implement in Story 6.2
    // macOS process signal handling
  }

  /**
   * Check for Homebrew installation
   */
  async checkHomebrew(): Promise<string | null> {
    // TODO: Implement in Story 6.2
    return null;
  }
}
