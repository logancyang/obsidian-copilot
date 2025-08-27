/**
 * ClaudeCliInterface - Low-level interface for Claude CLI execution
 *
 * Handles process spawning, command building, and platform-specific
 * execution details for the Claude CLI.
 */

import { spawn, SpawnOptions } from "child_process";

export interface CliExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
  duration?: number;
}

export interface ClaudeCliConfig {
  cliPath?: string;
  timeout?: number;
  debugMode?: boolean;
}

export class ClaudeCliInterface {
  private cliPath: string;
  private platform: NodeJS.Platform;
  private timeout: number;
  private debugMode: boolean;

  constructor(config: ClaudeCliConfig = {}) {
    this.cliPath = config.cliPath || "claude";
    this.timeout = config.timeout || 30000; // 30 seconds default
    this.debugMode = config.debugMode || false;
    this.platform = process.platform;

    if (this.debugMode) {
      console.log("ClaudeCliInterface initialized:", {
        cliPath: this.cliPath,
        timeout: this.timeout,
        platform: this.platform,
      });
    }
  }

  /**
   * Execute a Claude CLI command with arguments
   */
  async execute(args: string[], options?: SpawnOptions): Promise<CliExecutionResult> {
    const startTime = Date.now();

    if (this.debugMode) {
      console.log("Executing Claude CLI:", {
        command: this.cliPath,
        args,
        timeout: this.timeout,
      });
    }

    try {
      // Validate arguments to prevent command injection
      const validatedArgs = this.validateArgs(args);

      // Get platform-specific spawn options
      const spawnOptions = {
        ...this.getPlatformSpawnOptions(),
        ...options,
      };

      return new Promise((resolve) => {
        const child = spawn(this.cliPath, validatedArgs, spawnOptions);

        let stdout = "";
        let stderr = "";

        // Setup timeout handling
        const timeoutHandler = setTimeout(() => {
          if (this.debugMode) {
            console.log("Claude CLI execution timeout, terminating process");
          }

          child.kill("SIGTERM");

          // Give it a moment to terminate gracefully, then force kill
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          }, 1000);

          const duration = Date.now() - startTime;
          resolve({
            success: false,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: -1,
            error: new Error(`Command timeout after ${this.timeout}ms`),
            duration,
          });
        }, this.timeout);

        // Handle stdout data
        child.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        // Handle stderr data
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        // Handle process completion
        child.on("close", (code) => {
          clearTimeout(timeoutHandler);
          const duration = Date.now() - startTime;
          const success = code === 0;

          if (this.debugMode) {
            console.log("Claude CLI execution completed:", {
              exitCode: code,
              success,
              duration: `${duration}ms`,
              stdoutLength: stdout.length,
              stderrLength: stderr.length,
            });
          }

          resolve({
            success,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code,
            duration,
          });
        });

        // Handle spawn errors
        child.on("error", (error) => {
          clearTimeout(timeoutHandler);
          const duration = Date.now() - startTime;

          if (this.debugMode) {
            console.log("Claude CLI spawn error:", error.message);
          }

          resolve({
            success: false,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: null,
            error: this.createUserFriendlyError(error),
            duration,
          });
        });
      });
    } catch (validationError) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: validationError as Error,
        duration,
      };
    }
  }

  /**
   * Spawn a streaming Claude process
   */
  spawn(args: string[], options: SpawnOptions = {}) {
    // TODO: Implement in Story 3.2
    return spawn(this.cliPath, args, options);
  }

  /**
   * Validate CLI installation and version
   */
  async validateCli(): Promise<boolean> {
    try {
      const result = await this.testCliVersion();
      return result.success;
    } catch (error) {
      console.error("CLI validation failed:", error);
      return false;
    }
  }

  /**
   * Test Claude CLI version command and return detailed results
   */
  async testCliVersion(): Promise<{
    success: boolean;
    version?: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const spawnOptions: SpawnOptions = this.getPlatformSpawnOptions();
      const claude = spawn(this.cliPath, ["--version"], spawnOptions);

      let stdout = "";
      let stderr = "";

      claude.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      claude.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      claude.on("close", (code) => {
        const success = code === 0;
        const version = success ? this.parseVersion(stdout) : undefined;

        resolve({
          success,
          version,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
        });
      });

      claude.on("error", (err) => {
        resolve({
          success: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          error: err.message,
        });
      });
    });
  }

  /**
   * Get platform-specific spawn options
   */
  private getPlatformSpawnOptions(): SpawnOptions {
    const baseOptions: SpawnOptions = {
      env: process.env,
      cwd: process.cwd(),
    };

    // Windows may need shell for proper PATH resolution
    if (this.platform === "win32") {
      return {
        ...baseOptions,
        shell: true,
      };
    }

    return baseOptions;
  }

  /**
   * Parse version string from CLI output
   */
  private parseVersion(output: string): string | undefined {
    // Look for version patterns like "claude 1.0.0" or "version 1.0.0"
    const versionMatch = output.match(/(?:claude|version)\s+(\d+\.\d+\.\d+)/i);
    return versionMatch ? versionMatch[1] : output.trim();
  }

  /**
   * Build command arguments for Claude CLI
   */
  buildArgs(prompt: string, options: any = {}): string[] {
    const args: string[] = [];

    // Add model selection if specified
    if (options.model) {
      args.push("--model", options.model);
    }

    // Add session mode if specified
    if (options.sessionMode === "continue") {
      args.push("--continue");
    }

    // Add other CLI flags based on options
    if (options.stream === false) {
      args.push("--no-stream");
    }

    if (options.maxTokens) {
      args.push("--max-tokens", options.maxTokens.toString());
    }

    if (options.temperature !== undefined) {
      args.push("--temperature", options.temperature.toString());
    }

    // Add the prompt as the final argument
    if (prompt) {
      args.push(prompt);
    }

    if (this.debugMode) {
      console.log("Built Claude CLI arguments:", args);
    }

    return args;
  }

  /**
   * Validate arguments to prevent command injection
   */
  private validateArgs(args: string[]): string[] {
    return args.map((arg, index) => {
      // Check for dangerous characters
      const dangerousPatterns = [
        /[;&|`$()]/, // Shell command separators and substitution
        /\.\.\//, // Directory traversal
        /^-{3,}/, // Multiple dashes (potential flag confusion)
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(arg)) {
          throw new Error(
            `Unsafe argument detected at position ${index}: "${arg}". ` +
              "Arguments cannot contain shell command separators or dangerous characters."
          );
        }
      }

      // Additional validation for flag arguments
      if (arg.startsWith("-") && arg.length > 2 && !arg.startsWith("--")) {
        // Ensure single-letter flags are properly formatted
        if (!/^-[a-zA-Z]$/.test(arg.substring(0, 2))) {
          throw new Error(
            `Invalid flag format at position ${index}: "${arg}". ` +
              "Single-letter flags should be in format '-x' or use '--long-name'."
          );
        }
      }

      return arg;
    });
  }

  /**
   * Create user-friendly error messages from system errors
   */
  private createUserFriendlyError(systemError: NodeJS.ErrnoException): Error {
    const code = systemError.code;
    const message = systemError.message;

    switch (code) {
      case "ENOENT":
        return new Error(
          `Claude CLI not found at "${this.cliPath}". ` +
            "Please ensure Claude Code CLI is installed and in your PATH. " +
            "Installation guide: https://claude.ai/code"
        );

      case "EACCES":
        return new Error(
          `Permission denied when executing Claude CLI at "${this.cliPath}". ` +
            "Please check file permissions and ensure the CLI is executable."
        );

      case "EMFILE":
      case "ENFILE":
        return new Error("Too many open files. Please close some applications and try again.");

      default:
        return new Error(
          `Claude CLI execution failed: ${message}. ` +
            "Please check your Claude Code installation and try again."
        );
    }
  }
}
