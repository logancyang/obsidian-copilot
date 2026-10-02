import { Platform } from "obsidian";
import {
  buildObsidianCliArgs,
  isDesktopRuntime,
  runRandomReadCommand,
  runObsidianCliCommand,
} from "@/services/obsidianCli/ObsidianCliClient";

type ExecError = Error & { code?: string | number | null; signal?: string | null };

type MockExecCallback = (error: ExecError | null, stdout: string, stderr: string) => void;

type MockExecArgs = [
  binary: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
  callback: MockExecCallback,
];

interface TestRequireContainer {
  require?: (id: string) => unknown;
}

const MACOS_BINARY = "/Applications/Obsidian.app/Contents/MacOS/obsidian";
const MACOS_CAPITALIZED_BINARY = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";

function execError(code: string | number, message = "spawn failed"): ExecError {
  return Object.assign(new Error(message), { code });
}

function installExecFile(
  implementation: (binary: string, callback: MockExecCallback) => void
): jest.Mock<void, MockExecArgs> {
  const execFileMock = jest.fn<void, MockExecArgs>((binary, _args, _options, callback) =>
    implementation(binary, callback)
  );
  (window as unknown as TestRequireContainer).require = jest.fn((id: string) =>
    id === "child_process" ? { execFile: execFileMock } : {}
  );
  return execFileMock;
}

describe("ObsidianCliClient", () => {
  let originalRequire: ((id: string) => unknown) | undefined;

  beforeEach(() => {
    const platform = Platform as unknown as { isDesktopApp?: boolean; isDesktop?: boolean };
    platform.isDesktopApp = true;
    originalRequire = (window as unknown as TestRequireContainer).require;
  });

  afterEach(() => {
    const container = window as unknown as TestRequireContainer;
    if (originalRequire) {
      container.require = originalRequire;
    } else {
      delete container.require;
    }
    jest.clearAllMocks();
  });

  describe("isDesktopRuntime()", () => {
    it("returns true when Obsidian reports the desktop app", () => {
      (Platform as unknown as { isDesktopApp: boolean }).isDesktopApp = true;

      expect(isDesktopRuntime()).toBe(true);
    });

    it("returns false when Obsidian does not report the desktop app", () => {
      (Platform as unknown as { isDesktopApp: boolean }).isDesktopApp = false;

      expect(isDesktopRuntime()).toBe(false);
    });
  });

  describe("buildObsidianCliArgs()", () => {
    it("places the vault before the command and serializes params alphabetically", () => {
      const args = buildObsidianCliArgs({
        command: "daily:read",
        vault: "Personal",
        params: {
          alpha: "first",
          flagEnabled: true,
          ignoredFalseFlag: false,
          multiline: "line1\nline2",
        },
      });

      expect(args).toEqual([
        "vault=Personal",
        "daily:read",
        "alpha=first",
        "flagEnabled",
        "multiline=line1\\nline2",
      ]);
    });
  });

  describe("runObsidianCliCommand()", () => {
    it("returns the process output of a successful command", async () => {
      const execFileMock = installExecFile((_binary, callback) =>
        callback(null, "Daily note content", "")
      );

      const result = await runObsidianCliCommand({
        command: "daily:read",
        vault: "Work",
        timeoutMs: 5000,
      });

      expect(result).toMatchObject({
        ok: true,
        command: "daily:read",
        args: ["vault=Work", "daily:read"],
        stdout: "Daily note content",
        stderr: "",
        exitCode: 0,
      });
      expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to the macOS app binary when the default binary is missing", async () => {
      const execFileMock = installExecFile((binary, callback) =>
        binary === MACOS_BINARY
          ? callback(null, "Recovered via fallback binary", "")
          : callback(execError("ENOENT"), "", "")
      );

      const result = await runObsidianCliCommand({ command: "random:read" });

      expect(result.ok).toBe(true);
      expect(result.binary).toBe(MACOS_BINARY);
      expect(result.attemptedBinaries).toEqual(["obsidian", MACOS_BINARY]);
      expect(execFileMock).toHaveBeenCalledTimes(2);
    });

    it("reports every attempted binary when none can be found", async () => {
      installExecFile((_binary, callback) =>
        callback(execError("ENOENT", "spawn ENOENT"), "", "command not found")
      );

      const result = await runObsidianCliCommand({ command: "daily:read" });

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("ENOENT");
      expect(result.exitCode).toBeNull();
      expect(result.stderr).toBe("command not found");
      expect(result.attemptedBinaries).toEqual([
        "obsidian",
        MACOS_BINARY,
        MACOS_CAPITALIZED_BINARY,
      ]);
    });

    it("returns a non-ENOENT failure without trying the remaining binaries", async () => {
      const execFileMock = installExecFile((_binary, callback) =>
        callback(execError(2), "", "unknown command")
      );

      const result = await runObsidianCliCommand({ command: "nope:read" });

      expect(result).toMatchObject({ ok: false, exitCode: 2, stderr: "unknown command" });
      expect(result.attemptedBinaries).toEqual(["obsidian"]);
      expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it("rejects on a non-desktop runtime", async () => {
      (Platform as unknown as { isDesktopApp: boolean }).isDesktopApp = false;

      await expect(runObsidianCliCommand({ command: "daily:read" })).rejects.toThrow(
        "only supported in desktop Obsidian"
      );
    });
  });

  describe("runRandomReadCommand()", () => {
    it("runs random:read against the given vault", async () => {
      installExecFile((_binary, callback) => callback(null, "Random note content", ""));

      const result = await runRandomReadCommand("Personal");

      expect(result).toMatchObject({
        ok: true,
        command: "random:read",
        args: ["vault=Personal", "random:read"],
        stdout: "Random note content",
      });
    });
  });
});
