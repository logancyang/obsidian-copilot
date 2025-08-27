/**
 * Unit tests for ClaudeCliInterface
 *
 * Tests CLI execution, argument building, validation, and error handling
 * as specified in Story 2.2
 */

import { ClaudeCliInterface, ClaudeCliConfig } from "./ClaudeCliInterface";

// Mock child_process module
jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

// Mock process events for testing
class MockChildProcess {
  stdout = { on: jest.fn() };
  stderr = { on: jest.fn() };
  on = jest.fn();
  kill = jest.fn();
  killed = false;

  constructor() {
    // Setup default behavior for data events
    this.stdout.on.mockImplementation((event: string, callback: (data: Buffer) => void) => {
      if (event === "data") {
        // Store callback for later use in tests
        (this as any).stdoutCallback = callback;
      }
    });

    this.stderr.on.mockImplementation((event: string, callback: (data: Buffer) => void) => {
      if (event === "data") {
        (this as any).stderrCallback = callback;
      }
    });
  }

  // Helper methods for tests
  simulateStdout(data: string) {
    if ((this as any).stdoutCallback) {
      (this as any).stdoutCallback(Buffer.from(data));
    }
  }

  simulateStderr(data: string) {
    if ((this as any).stderrCallback) {
      (this as any).stderrCallback(Buffer.from(data));
    }
  }

  simulateClose(exitCode: number) {
    const callback = this.on.mock.calls.find((call) => call[0] === "close")?.[1];
    if (callback) {
      callback(exitCode);
    }
  }

  simulateError(error: Error) {
    const callback = this.on.mock.calls.find((call) => call[0] === "error")?.[1];
    if (callback) {
      callback(error);
    }
  }
}

describe("ClaudeCliInterface", () => {
  let mockChild: MockChildProcess;
  let mockSpawn: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockChild = new MockChildProcess();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockSpawn = require("child_process").spawn as jest.MockedFunction<any>;
    mockSpawn.mockReturnValue(mockChild);

    // Mock setTimeout and clearTimeout for timeout tests
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Constructor and Configuration", () => {
    test("should create with default configuration", () => {
      const cli = new ClaudeCliInterface();

      // Should not throw and should be properly initialized
      expect(cli).toBeInstanceOf(ClaudeCliInterface);
    });

    test("should create with custom configuration", () => {
      const config: ClaudeCliConfig = {
        cliPath: "/custom/claude",
        timeout: 60000,
        debugMode: true,
      };

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const cli = new ClaudeCliInterface(config);

      expect(cli).toBeInstanceOf(ClaudeCliInterface);
      expect(consoleSpy).toHaveBeenCalledWith(
        "ClaudeCliInterface initialized:",
        expect.objectContaining({
          cliPath: "/custom/claude",
          timeout: 60000,
        })
      );

      consoleSpy.mockRestore();
    });
  });

  describe("buildArgs method", () => {
    let cli: ClaudeCliInterface;

    beforeEach(() => {
      cli = new ClaudeCliInterface();
    });

    test("should build basic arguments with prompt", () => {
      const args = cli.buildArgs("Hello Claude!");

      expect(args).toEqual(["Hello Claude!"]);
    });

    test("should build arguments with model option", () => {
      const args = cli.buildArgs("Test prompt", { model: "opus" });

      expect(args).toEqual(["--model", "opus", "Test prompt"]);
    });

    test("should build arguments with multiple options", () => {
      const args = cli.buildArgs("Test", {
        model: "sonnet",
        sessionMode: "continue",
        maxTokens: 1000,
        temperature: 0.7,
        stream: false,
      });

      expect(args).toEqual([
        "--model",
        "sonnet",
        "--continue",
        "--no-stream",
        "--max-tokens",
        "1000",
        "--temperature",
        "0.7",
        "Test",
      ]);
    });

    test("should handle empty prompt", () => {
      const args = cli.buildArgs("", { model: "haiku" });

      expect(args).toEqual(["--model", "haiku"]);
    });
  });

  describe("Argument validation", () => {
    let cli: ClaudeCliInterface;

    beforeEach(() => {
      cli = new ClaudeCliInterface();
    });

    test("should reject dangerous shell characters", async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error("Should not reach spawn");
      });

      const result = await cli.execute(["test; rm -rf /"]);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Unsafe argument detected");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    test("should reject command injection attempts", async () => {
      const dangerousArgs = [
        "test && rm file",
        "test | cat /etc/passwd",
        "test `whoami`",
        "test $(id)",
        "test & background",
      ];

      for (const arg of dangerousArgs) {
        const result = await cli.execute([arg]);
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("Unsafe argument");
      }
    });

    test("should allow safe arguments", async () => {
      // Create a mock that simulates successful execution
      const promise = cli.execute(["--version", "normal text", "-h"]);

      // Simulate successful completion immediately
      setTimeout(() => {
        mockChild.simulateClose(0);
      }, 0);

      jest.advanceTimersByTime(50);

      await promise;
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe("execute method", () => {
    let cli: ClaudeCliInterface;

    beforeEach(() => {
      cli = new ClaudeCliInterface({ timeout: 5000 });
    });

    test("should execute successfully with output", async () => {
      const promise = cli.execute(["--version"]);

      // Simulate process execution
      setTimeout(() => {
        mockChild.simulateStdout("claude version 1.0.93");
        mockChild.simulateClose(0);
      }, 0);

      jest.advanceTimersByTime(50);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("claude version 1.0.93");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    test("should handle command failure with stderr", async () => {
      const promise = cli.execute(["--invalid-flag"]);

      setTimeout(() => {
        mockChild.simulateStderr("Unknown option: --invalid-flag");
        mockChild.simulateClose(1);
      }, 0);

      jest.advanceTimersByTime(50);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Unknown option: --invalid-flag");
      expect(result.exitCode).toBe(1);
    });

    test("should handle spawn errors", async () => {
      const promise = cli.execute(["test"]);

      setTimeout(() => {
        const error = new Error("spawn ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        mockChild.simulateError(error);
      }, 0);

      jest.advanceTimersByTime(50);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBeNull();
      expect(result.error?.message).toContain("Claude CLI not found");
      expect(result.error?.message).toContain("Installation guide");
    });

    test("should handle timeout", async () => {
      const promise = cli.execute(["long-running-command"]);

      // Don't simulate any response, let timeout occur
      jest.advanceTimersByTime(6000); // Advance past 5s timeout

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error?.message).toContain("Command timeout after 5000ms");
      expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
    });

    test("should handle permission errors", async () => {
      const promise = cli.execute(["test"]);

      setTimeout(() => {
        const error = new Error("spawn EACCES") as NodeJS.ErrnoException;
        error.code = "EACCES";
        mockChild.simulateError(error);
      }, 0);

      jest.advanceTimersByTime(50);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Permission denied");
      expect(result.error?.message).toContain("check file permissions");
    });
  });

  describe("Debug mode", () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, "log").mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    test("should log when debug mode is enabled", () => {
      new ClaudeCliInterface({ debugMode: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        "ClaudeCliInterface initialized:",
        expect.any(Object)
      );
    });

    test("should log execution details in debug mode", async () => {
      const cli = new ClaudeCliInterface({ debugMode: true });

      const promise = cli.execute(["--version"]);

      setTimeout(() => {
        mockChild.simulateClose(0);
      }, 0);

      jest.advanceTimersByTime(50);
      await promise;

      expect(consoleSpy).toHaveBeenCalledWith(
        "Executing Claude CLI:",
        expect.objectContaining({
          command: "claude",
          args: ["--version"],
        })
      );
    });

    test("should log buildArgs in debug mode", () => {
      new ClaudeCliInterface({ debugMode: true }).buildArgs("test", { model: "sonnet" });

      expect(consoleSpy).toHaveBeenCalledWith("Built Claude CLI arguments:", [
        "--model",
        "sonnet",
        "test",
      ]);
    });
  });

  describe("Platform-specific behavior", () => {
    test("should use shell on Windows", () => {
      const originalPlatform = process.platform;

      // Mock Windows platform
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      new ClaudeCliInterface().execute(["--version"]);

      setTimeout(() => {
        mockChild.simulateClose(0);
      }, 0);

      jest.advanceTimersByTime(50);

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        ["--version"],
        expect.objectContaining({
          shell: true,
        })
      );

      // Restore original platform
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });
  });
});
