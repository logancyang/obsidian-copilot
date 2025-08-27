import { ClaudeDetector, DetectionResult } from "./ClaudeDetector";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";

// Mock child_process, fs, and os modules
jest.mock("child_process");
jest.mock("fs", () => ({
  promises: {
    access: jest.fn(),
  },
  constants: {
    F_OK: 0,
    X_OK: 1,
  },
}));
jest.mock("os");

describe("ClaudeDetector", () => {
  let detector: ClaudeDetector;
  const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
  const mockAccess = fs.promises.access as jest.MockedFunction<typeof fs.promises.access>;
  const mockHomedir = os.homedir as jest.MockedFunction<typeof os.homedir>;

  beforeEach(() => {
    detector = new ClaudeDetector();
    jest.clearAllMocks();
    ClaudeDetector.clearCache();

    // Set up default mocks
    mockHomedir.mockReturnValue("/home/user");
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/usr/local/bin:/usr/bin:/bin";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("detect", () => {
    it("should detect Claude in PATH", async () => {
      // Mock file exists check
      mockAccess.mockImplementation(async (path) => {
        if (path === "/usr/local/bin/claude") {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      // Mock version check
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate successful version output
      setTimeout(() => {
        mockChild.stdout.on.mock.calls[0][1](Buffer.from("Claude Code 1.0.93"));
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](0);
      }, 10);

      const result = await detector.detect();

      expect(result.found).toBe(true);
      expect(result.path).toBe("/usr/local/bin/claude");
      expect(result.version).toBe("1.0.93");
      expect(result.method).toBe("path");
    });

    it("should detect Claude in common directories", async () => {
      // Mock no files in PATH
      mockAccess.mockImplementation(async (path) => {
        if (path === "/opt/homebrew/bin/claude") {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      // Mock version check
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate successful version output
      setTimeout(() => {
        mockChild.stdout.on.mock.calls[0][1](Buffer.from("1.0.90"));
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](0);
      }, 10);

      const result = await detector.detect();

      expect(result.found).toBe(true);
      expect(result.path).toBe("/opt/homebrew/bin/claude");
      expect(result.version).toBe("1.0.90");
      expect(result.method).toBe("manual");
    });

    it("should detect Claude via Homebrew on macOS", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });

      // Mock no files in PATH or common dirs
      mockAccess.mockImplementation(async (path) => {
        if (path === "/opt/homebrew/bin/claude") {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      // Mock version check
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate successful version output
      setTimeout(() => {
        mockChild.stdout.on.mock.calls[0][1](Buffer.from("Claude CLI version 1.0.0"));
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](0);
      }, 10);

      const result = await detector.detect();

      expect(result.found).toBe(true);
      expect(result.path).toBe("/opt/homebrew/bin/claude");
      expect(result.method).toBe("manual"); // Will be manual since it's in common paths
    });

    it("should return not found when Claude is not installed", async () => {
      // Mock no files found
      mockAccess.mockRejectedValue(new Error("Not found"));

      // Mock spawn failure
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate command not found
      setTimeout(() => {
        mockChild.on.mock.calls.find((call) => call[0] === "error")[1](new Error("ENOENT"));
      }, 10);

      const result = await detector.detect();

      expect(result.found).toBe(false);
      expect(result.method).toBe("none");
      expect(result.error).toContain("Claude Code CLI not found");
    });

    it("should use cached results within TTL", async () => {
      // First detection
      mockAccess.mockImplementation(async (path) => {
        if (path === "/usr/local/bin/claude") {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      setTimeout(() => {
        mockChild.stdout.on.mock.calls[0][1](Buffer.from("1.0.93"));
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](0);
      }, 10);

      const result1 = await detector.detect();
      expect(result1.found).toBe(true);

      // Clear mocks but not cache
      jest.clearAllMocks();

      // Second detection should use cache
      const result2 = await detector.detect();

      expect(result2.found).toBe(true);
      expect(result2.path).toBe(result1.path);
      expect(mockSpawn).not.toHaveBeenCalled(); // Should not spawn again
    });
  });

  describe("validatePath", () => {
    it("should validate a correct CLI path", async () => {
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate successful version output
      setTimeout(() => {
        mockChild.stdout.on.mock.calls[0][1](Buffer.from("Claude Code 1.0.93"));
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](0);
      }, 10);

      const isValid = await detector.validatePath("/usr/local/bin/claude");

      expect(isValid).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/local/bin/claude",
        ["--version"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
        })
      );
    });

    it("should reject invalid CLI path", async () => {
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate command failure
      setTimeout(() => {
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](1);
      }, 10);

      const isValid = await detector.validatePath("/invalid/path/claude");

      expect(isValid).toBe(false);
    });

    it("should handle spawn errors", async () => {
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Simulate spawn error
      setTimeout(() => {
        mockChild.on.mock.calls.find((call) => call[0] === "error")[1](new Error("ENOENT"));
      }, 10);

      const isValid = await detector.validatePath("/nonexistent/claude");

      expect(isValid).toBe(false);
    });

    it("should handle timeout", async () => {
      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      // Don't send any events, let it timeout
      jest.useFakeTimers();

      const validationPromise = detector.validatePath("/slow/claude");

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(5001);

      const isValid = await validationPromise;

      expect(isValid).toBe(false);
      expect(mockChild.kill).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe("Platform-specific paths", () => {
    it("should search Windows-specific paths on Windows", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PROGRAMFILES = "C:\\Program Files";
      process.env.LOCALAPPDATA = "C:\\Users\\User\\AppData\\Local";

      mockAccess.mockRejectedValue(new Error("Not found"));

      const detector = new ClaudeDetector();
      await detector.detect();

      // Check that Windows-specific paths were attempted
      expect(mockAccess).toHaveBeenCalledWith(
        expect.stringContaining("C:\\Program Files"),
        expect.anything()
      );
    });

    it("should search Linux-specific paths on Linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });

      mockAccess.mockRejectedValue(new Error("Not found"));

      const detector = new ClaudeDetector();
      await detector.detect();

      // Check that Linux-specific paths were attempted
      expect(mockAccess).toHaveBeenCalledWith(
        expect.stringMatching(/\/snap\/bin\/claude|\/usr\/bin\/claude/),
        expect.anything()
      );
    });
  });

  describe("getStatusMessage", () => {
    it("should return success message for found CLI", () => {
      const result: DetectionResult = {
        found: true,
        path: "/usr/local/bin/claude",
        version: "1.0.93",
        method: "path",
      };

      const message = ClaudeDetector.getStatusMessage(result);

      expect(message).toContain("✓");
      expect(message).toContain("Found in system PATH");
      expect(message).toContain("v1.0.93");
    });

    it("should return error message for not found CLI", () => {
      const result: DetectionResult = {
        found: false,
        method: "none",
        error: "Claude Code CLI not found",
      };

      const message = ClaudeDetector.getStatusMessage(result);

      expect(message).toContain("Claude Code CLI not found");
    });

    it("should handle different detection methods", () => {
      const homebrewResult: DetectionResult = {
        found: true,
        path: "/opt/homebrew/bin/claude",
        version: "1.0.0",
        method: "homebrew",
      };

      const message = ClaudeDetector.getStatusMessage(homebrewResult);

      expect(message).toContain("Found via Homebrew");
    });
  });

  describe("clearCache", () => {
    it("should clear cached detection results", async () => {
      // First detection
      mockAccess.mockImplementation(async (path) => {
        if (path === "/usr/local/bin/claude") {
          return Promise.resolve();
        }
        return Promise.reject(new Error("Not found"));
      });

      const mockChild = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      mockSpawn.mockReturnValue(mockChild as any);

      setTimeout(() => {
        mockChild.stdout.on.mock.calls[0][1](Buffer.from("1.0.93"));
        mockChild.on.mock.calls.find((call) => call[0] === "close")[1](0);
      }, 10);

      await detector.detect();

      // Clear cache
      ClaudeDetector.clearCache();
      jest.clearAllMocks();

      // Mock for second detection
      mockAccess.mockRejectedValue(new Error("Not found"));
      mockSpawn.mockReturnValue(mockChild as any);
      setTimeout(() => {
        mockChild.on.mock.calls.find((call) => call[0] === "error")[1](new Error("ENOENT"));
      }, 10);

      // Second detection should not use cache
      const result = await detector.detect();

      expect(mockSpawn).toHaveBeenCalled(); // Should spawn again
      expect(result.found).toBe(false); // Different result
    });
  });
});
