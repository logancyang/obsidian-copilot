/**
 * Unit tests for securityHooks
 */

import {
  isCommandBlocked,
  isPathAllowed,
  createSecurityHooks,
  validatePath,
  validateBashCommand,
  DEFAULT_BLOCKED_COMMANDS,
  SecurityHooksOptions,
} from "./securityHooks";

// Mock the logger to prevent console output during tests
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// Mock path module for cross-platform tests
jest.mock("path", () => {
  const actualPath = jest.requireActual("path");
  return {
    ...actualPath,
    resolve: (p: string) => {
      // Simulate path resolution
      if (p.startsWith("/")) return p;
      return `/current/dir/${p}`;
    },
    sep: "/",
    dirname: actualPath.dirname,
    basename: actualPath.basename,
  };
});

describe("isCommandBlocked", () => {
  describe("Unix destructive commands", () => {
    it("should block rm -rf /", () => {
      const result = isCommandBlocked("rm -rf /", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("rm -rf /");
    });

    it("should block rm -rf ~", () => {
      const result = isCommandBlocked("rm -rf ~", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block rm -rf /* with variation", () => {
      const result = isCommandBlocked("rm -rf /*", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block sudo rm commands", () => {
      const result = isCommandBlocked("sudo rm -rf /var/log", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block fork bomb", () => {
      const result = isCommandBlocked(":(){:|:&};:", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block mkfs commands", () => {
      const result = isCommandBlocked("mkfs.ext4 /dev/sda1", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block dd commands", () => {
      const result = isCommandBlocked("dd if=/dev/zero of=/dev/sda", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block chmod 777 /", () => {
      const result = isCommandBlocked("chmod 777 /", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });
  });

  describe("Windows destructive commands", () => {
    it("should block format c:", () => {
      const result = isCommandBlocked("format c:", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block rd /s /q c:", () => {
      const result = isCommandBlocked("rd /s /q c:", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block del /f /s /q c:", () => {
      const result = isCommandBlocked("del /f /s /q c:", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });
  });

  describe("Remote code execution patterns", () => {
    it("should block curl | sh exact pattern", () => {
      const result = isCommandBlocked("curl | sh", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block wget | bash exact pattern", () => {
      const result = isCommandBlocked("wget | bash", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block commands containing curl | sh pattern", () => {
      // Note: The blocklist uses substring matching, so this only matches
      // if the exact "curl | sh" pattern appears
      const result = isCommandBlocked("echo 'curl | sh' > script.sh", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });
  });

  describe("System modification commands", () => {
    it("should block writes to /etc/passwd", () => {
      const result = isCommandBlocked(
        "echo 'root::0:0::/root:/bin/bash' > /etc/passwd",
        DEFAULT_BLOCKED_COMMANDS
      );
      expect(result.blocked).toBe(true);
    });

    it("should block shutdown command", () => {
      const result = isCommandBlocked("shutdown -h now", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should block reboot command", () => {
      const result = isCommandBlocked("reboot", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });
  });

  describe("Safe commands", () => {
    it("should allow ls command", () => {
      const result = isCommandBlocked("ls -la", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });

    it("should allow cat command", () => {
      const result = isCommandBlocked("cat /etc/hosts", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });

    it("should allow git commands", () => {
      const result = isCommandBlocked("git status", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });

    it("should allow npm commands", () => {
      const result = isCommandBlocked("npm install", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });

    it("should allow safe rm commands", () => {
      const result = isCommandBlocked("rm -rf ./node_modules", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty command", () => {
      const result = isCommandBlocked("", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });

    it("should handle null command", () => {
      const result = isCommandBlocked(null as any, DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(false);
    });

    it("should be case insensitive", () => {
      const result = isCommandBlocked("RM -RF /", DEFAULT_BLOCKED_COMMANDS);
      expect(result.blocked).toBe(true);
    });

    it("should handle custom blocked commands", () => {
      const customBlocked = ["custom-dangerous-cmd"];
      const result = isCommandBlocked("custom-dangerous-cmd", customBlocked);
      expect(result.blocked).toBe(true);
    });
  });
});

describe("isPathAllowed", () => {
  const vaultPath = "/Users/test/vault";
  const allowedPaths = ["/tmp", "/Users/test/allowed"];

  describe("vault path checks", () => {
    it("should allow paths within vault", () => {
      const result = isPathAllowed("/Users/test/vault/notes/test.md", [], vaultPath);
      expect(result).toBe(true);
    });

    it("should allow vault root path", () => {
      const result = isPathAllowed("/Users/test/vault", [], vaultPath);
      expect(result).toBe(true);
    });

    it("should block paths outside vault", () => {
      const result = isPathAllowed("/Users/other/file.txt", [], vaultPath);
      expect(result).toBe(false);
    });
  });

  describe("allowed paths", () => {
    it("should allow paths in allowedPaths", () => {
      const result = isPathAllowed("/tmp/tempfile.txt", allowedPaths, vaultPath);
      expect(result).toBe(true);
    });

    it("should allow nested paths in allowedPaths", () => {
      const result = isPathAllowed("/Users/test/allowed/subdir/file.md", allowedPaths, vaultPath);
      expect(result).toBe(true);
    });

    it("should block paths not in vault or allowedPaths", () => {
      const result = isPathAllowed("/home/user/secret.txt", allowedPaths, vaultPath);
      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty path", () => {
      const result = isPathAllowed("", allowedPaths, vaultPath);
      expect(result).toBe(false);
    });

    it("should handle null path", () => {
      const result = isPathAllowed(null as any, allowedPaths, vaultPath);
      expect(result).toBe(false);
    });

    it("should handle paths with different case", () => {
      // Case sensitivity depends on platform, our implementation normalizes to lowercase
      const result = isPathAllowed("/USERS/TEST/VAULT/test.md", [], vaultPath);
      expect(result).toBe(true);
    });
  });
});

describe("createSecurityHooks", () => {
  const options: SecurityHooksOptions = {
    vaultPath: "/Users/test/vault",
    allowedPaths: ["/tmp"],
    blockedCommands: DEFAULT_BLOCKED_COMMANDS,
  };

  describe("preToolUse hook", () => {
    it("should return allowed for safe Bash commands", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Bash", { command: "ls -la" });

      expect(result.allowed).toBe(true);
    });

    it("should block dangerous Bash commands", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Bash", { command: "rm -rf /" });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked pattern");
    });

    it("should block Bash commands with paths outside allowed areas", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Bash", {
        command: "cat /etc/passwd",
      });

      // This should be blocked because /etc/passwd is outside allowed paths
      expect(result.allowed).toBe(false);
    });

    it("should allow Bash commands with paths inside vault", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Bash", {
        command: "cat /Users/test/vault/notes.md",
      });

      expect(result.allowed).toBe(true);
    });

    it("should allow Read tool for vault files", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Read", {
        file_path: "/Users/test/vault/test.md",
      });

      expect(result.allowed).toBe(true);
    });

    it("should block Read tool for files outside vault", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Read", {
        file_path: "/etc/passwd",
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside allowed areas");
    });

    it("should allow Write tool for vault files", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Write", {
        file_path: "/Users/test/vault/newfile.md",
      });

      expect(result.allowed).toBe(true);
    });

    it("should block Write tool for files outside vault", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Write", {
        file_path: "/etc/hosts",
      });

      expect(result.allowed).toBe(false);
    });

    it("should allow Edit tool for vault files", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Edit", {
        file_path: "/Users/test/vault/existing.md",
      });

      expect(result.allowed).toBe(true);
    });

    it("should allow Glob tool for vault path", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Glob", {
        path: "/Users/test/vault",
      });

      expect(result.allowed).toBe(true);
    });

    it("should block Glob tool for paths outside vault", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Glob", {
        path: "/etc",
      });

      expect(result.allowed).toBe(false);
    });

    it("should allow Grep tool for vault path", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Grep", {
        path: "/Users/test/vault",
      });

      expect(result.allowed).toBe(true);
    });

    it("should allow tools in allowedPaths", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("Read", {
        file_path: "/tmp/tempfile.txt",
      });

      expect(result.allowed).toBe(true);
    });

    it("should allow unknown tools", () => {
      const { preToolUse } = createSecurityHooks(options);
      const result = preToolUse("UnknownTool", {
        some_param: "value",
      });

      expect(result.allowed).toBe(true);
    });

    it("should handle different path parameter names", () => {
      const { preToolUse } = createSecurityHooks(options);

      // Test filePath
      expect(preToolUse("Read", { filePath: "/Users/test/vault/test.md" }).allowed).toBe(true);

      // Test path
      expect(preToolUse("Read", { path: "/Users/test/vault/test.md" }).allowed).toBe(true);

      // Test target
      expect(preToolUse("Read", { target: "/Users/test/vault/test.md" }).allowed).toBe(true);
    });
  });
});

describe("validatePath", () => {
  const options: SecurityHooksOptions = {
    vaultPath: "/Users/test/vault",
    allowedPaths: ["/tmp"],
    blockedCommands: [],
  };

  it("should return allowed for valid vault paths", () => {
    const result = validatePath("/Users/test/vault/file.md", options);
    expect(result.allowed).toBe(true);
  });

  it("should return not allowed for paths outside vault", () => {
    const result = validatePath("/etc/passwd", options);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("outside allowed areas");
  });

  it("should return allowed for paths in allowedPaths", () => {
    const result = validatePath("/tmp/tempfile.txt", options);
    expect(result.allowed).toBe(true);
  });
});

describe("validateBashCommand", () => {
  const options: SecurityHooksOptions = {
    vaultPath: "/Users/test/vault",
    allowedPaths: ["/tmp"],
    blockedCommands: DEFAULT_BLOCKED_COMMANDS,
  };

  it("should return allowed for safe commands", () => {
    const result = validateBashCommand("ls -la /Users/test/vault", options);
    expect(result.allowed).toBe(true);
  });

  it("should return not allowed for blocked commands", () => {
    const result = validateBashCommand("rm -rf /", options);
    expect(result.allowed).toBe(false);
  });

  it("should return not allowed for commands accessing restricted paths", () => {
    const result = validateBashCommand("cat /etc/shadow", options);
    expect(result.allowed).toBe(false);
  });
});

describe("DEFAULT_BLOCKED_COMMANDS", () => {
  it("should contain Unix destructive commands", () => {
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("rm -rf /");
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("sudo rm");
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("mkfs.");
  });

  it("should contain Windows destructive commands", () => {
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("format c:");
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("rd /s /q c:");
  });

  it("should contain remote code execution patterns", () => {
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("curl | sh");
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("wget | bash");
  });

  it("should contain system modification commands", () => {
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("shutdown");
    expect(DEFAULT_BLOCKED_COMMANDS).toContain("reboot");
  });
});
