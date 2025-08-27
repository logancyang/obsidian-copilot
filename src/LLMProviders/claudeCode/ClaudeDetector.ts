/**
 * ClaudeDetector - Auto-detection logic for Claude CLI installation
 *
 * Handles platform-specific detection of Claude CLI installations,
 * searching common paths and validating availability.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface DetectionResult {
  found: boolean;
  path?: string;
  version?: string;
  method: "path" | "homebrew" | "manual" | "none";
  error?: string;
  timestamp?: number;
}

export class ClaudeDetector {
  private platform: NodeJS.Platform;
  private static cache: Map<string, DetectionResult> = new Map();
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.platform = process.platform;
  }

  /**
   * Detect Claude CLI installation
   */
  async detect(): Promise<DetectionResult> {
    // Check cache first
    const cacheKey = `claude-detection-${this.platform}`;
    const cached = ClaudeDetector.cache.get(cacheKey);

    if (cached && cached.timestamp && Date.now() - cached.timestamp < ClaudeDetector.CACHE_TTL) {
      return { ...cached, method: cached.method as any };
    }

    // Try PATH detection first (fastest)
    const pathResult = await this.checkPath();
    if (pathResult) {
      const result: DetectionResult = {
        found: true,
        path: pathResult.path,
        version: pathResult.version,
        method: "path",
        timestamp: Date.now(),
      };
      ClaudeDetector.cache.set(cacheKey, result);
      return result;
    }

    // Try common installation directories
    const dirResult = await this.searchCommonPaths();
    if (dirResult) {
      const result: DetectionResult = {
        found: true,
        path: dirResult.path,
        version: dirResult.version,
        method: "manual",
        timestamp: Date.now(),
      };
      ClaudeDetector.cache.set(cacheKey, result);
      return result;
    }

    // Check for Homebrew on macOS
    if (this.platform === "darwin") {
      const homebrewResult = await this.checkHomebrew();
      if (homebrewResult) {
        const result: DetectionResult = {
          found: true,
          path: homebrewResult.path,
          version: homebrewResult.version,
          method: "homebrew",
          timestamp: Date.now(),
        };
        ClaudeDetector.cache.set(cacheKey, result);
        return result;
      }
    }

    // Not found
    const result: DetectionResult = {
      found: false,
      method: "none",
      error: "Claude Code CLI not found. Please install Claude Code or specify the path manually.",
      timestamp: Date.now(),
    };
    ClaudeDetector.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Search common installation directories
   */
  private async searchCommonPaths(): Promise<{ path: string; version?: string } | null> {
    const searchPaths = this.getPlatformPaths();

    for (const searchPath of searchPaths) {
      try {
        const claudePath = path.join(searchPath, this.getClaudeExecutableName());

        if (await this.fileExists(claudePath)) {
          const version = await this.getCliVersion(claudePath);
          if (version) {
            return { path: claudePath, version };
          }
        }
      } catch {
        // Continue searching other directories
        continue;
      }
    }

    return null;
  }

  /**
   * Check if claude is in system PATH
   */
  private async checkPath(): Promise<{ path: string; version?: string } | null> {
    const pathEnv = process.env.PATH || "";
    const separator = this.platform === "win32" ? ";" : ":";
    const claudeCmd = this.getClaudeExecutableName();

    const paths = pathEnv.split(separator).filter((p) => p.trim());

    for (const dir of paths) {
      try {
        const fullPath = path.join(dir, claudeCmd);

        if (await this.fileExists(fullPath)) {
          const version = await this.getCliVersion(fullPath);
          if (version) {
            return { path: fullPath, version };
          }
        }
      } catch {
        // Continue searching other paths
        continue;
      }
    }

    // Also try executing 'claude' directly
    try {
      const version = await this.getCliVersion("claude");
      if (version) {
        return { path: "claude", version };
      }
    } catch {
      // Not in PATH
    }

    return null;
  }

  /**
   * Check Homebrew installation on macOS
   */
  private async checkHomebrew(): Promise<{ path: string; version?: string } | null> {
    const homebrewPaths = [
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      path.join(os.homedir(), ".homebrew/bin/claude"),
    ];

    for (const brewPath of homebrewPaths) {
      if (await this.fileExists(brewPath)) {
        const version = await this.getCliVersion(brewPath);
        if (version) {
          return { path: brewPath, version };
        }
      }
    }

    return null;
  }

  /**
   * Get platform-specific search paths
   */
  private getPlatformPaths(): string[] {
    switch (this.platform) {
      case "darwin": // macOS
        return [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/usr/bin",
          path.join(os.homedir(), ".local/bin"),
          "/Applications/Claude.app/Contents/MacOS",
          path.join(os.homedir(), "Applications/Claude.app/Contents/MacOS"),
        ];

      case "win32": // Windows
        return [
          path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Claude"),
          path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Claude", "bin"),
          path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Claude"),
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Claude"),
          path.join(process.env.APPDATA || "", "Claude"),
          path.join(os.homedir(), "AppData", "Local", "Programs", "claude"),
          "C:\\Claude",
        ];

      case "linux": // Linux
        return [
          "/usr/bin",
          "/usr/local/bin",
          "/opt/claude",
          "/opt/claude/bin",
          path.join(os.homedir(), ".local/bin"),
          path.join(os.homedir(), ".claude/bin"),
          "/snap/bin",
          "/var/lib/flatpak/exports/bin",
        ];

      default:
        return ["/usr/local/bin", "/usr/bin"];
    }
  }

  /**
   * Get platform-specific executable name
   */
  private getClaudeExecutableName(): string {
    return this.platform === "win32" ? "claude.exe" : "claude";
  }

  /**
   * Check if file exists and is accessible
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK | fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get CLI version by executing --version
   */
  private async getCliVersion(cliPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 5000);

      const child = spawn(cliPath, ["--version"], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: this.platform === "win32",
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          // Parse version from output
          const output = stdout || stderr;
          const versionMatch = output.match(/(\d+\.\d+\.\d+)/);

          if (versionMatch) {
            resolve(versionMatch[1]);
          } else if (output.toLowerCase().includes("claude")) {
            // Claude CLI detected but version not parseable
            resolve("unknown");
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      child.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  /**
   * Validate detected CLI with --version
   */
  async validatePath(cliPath: string): Promise<boolean> {
    const version = await this.getCliVersion(cliPath);
    return version !== null;
  }

  /**
   * Clear cached detection results
   */
  static clearCache(): void {
    ClaudeDetector.cache.clear();
  }

  /**
   * Get detection status message for UI
   */
  static getStatusMessage(result: DetectionResult): string {
    if (result.found) {
      const methodMessages = {
        path: "Found in system PATH",
        homebrew: "Found via Homebrew",
        manual: "Found in common installation directory",
        none: "Not detected",
      };

      const method = methodMessages[result.method] || "Found";
      return `✓ Claude Code detected (${method})${result.version ? ` - v${result.version}` : ""}`;
    } else {
      return result.error || "✗ Claude Code not detected";
    }
  }
}
