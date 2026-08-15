import { Platform } from "obsidian";
import { promisify } from "node:util";

import { detectBinary, validateExecutableFile } from "./detectBinary";

// Keep the augmented PATH deterministic across CI/dev machines; the live
// version-manager probe is covered in nodeToolBinDirs.test.ts.
jest.mock("@/utils/nodeToolBinDirs", () => ({ resolveNodeToolBinDirs: jest.fn(() => []) }));

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
type ExecFileArgs = [
  string,
  readonly string[],
  { timeout?: number; env?: NodeJS.ProcessEnv },
  ExecFileCallback,
];

const execFileMock = jest.fn<void, ExecFileArgs>();

// Mock the bare module id — the form requireNodeModule() resolves at call
// time (it names the same core module instance as "node:child_process").
jest.mock("child_process", () => {
  const fn = (...args: ExecFileArgs): void => execFileMock(...args);
  // `node:util.promisify` consults this symbol to resolve to `{ stdout, stderr }`.
  // Without it the promisified call resolves to just `stdout`, which would
  // then be destructured as `undefined` in detectBinary.
  (fn as unknown as Record<symbol, unknown>)[promisify.custom] = (
    cmd: string,
    args: readonly string[],
    options: { timeout?: number; env?: NodeJS.ProcessEnv }
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      execFileMock(cmd, args, options, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { execFile: fn };
});

describe("detectBinary", () => {
  describe("detectBinary()", () => {
    const originalPlatform = process.platform;
    const originalPath = process.env.PATH;

    beforeEach(() => {
      execFileMock.mockReset();
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      process.env.PATH = originalPath;
    });

    function setPlatform(p: NodeJS.Platform): void {
      Object.defineProperty(process, "platform", { value: p });
    }

    test("rejects binary names with invalid characters", async () => {
      await expect(detectBinary("../evil")).rejects.toThrow(/Invalid binary name/);
      await expect(detectBinary("a b")).rejects.toThrow(/Invalid binary name/);
      expect(execFileMock).not.toHaveBeenCalled();
    });

    test("posix: augments PATH with /opt/homebrew/bin and /usr/local/bin ahead of inherited PATH", async () => {
      setPlatform("darwin");
      // The sparse launchd PATH that triggers the bug on macOS GUI launches.
      process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "/opt/homebrew/bin/codex-acp\n", "")
      );

      const found = await detectBinary("codex-acp");
      expect(found).toBe("/opt/homebrew/bin/codex-acp");

      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = execFileMock.mock.calls[0];
      expect(cmd).toBe("which");
      expect(args).toEqual(["codex-acp"]);
      expect(opts.env).toBeDefined();
      const pathParts = (opts.env?.PATH ?? "").split(":");
      expect(pathParts).toContain("/opt/homebrew/bin");
      expect(pathParts).toContain("/usr/local/bin");
      // Augmented dirs must precede whatever the GUI shell already had.
      expect(pathParts.indexOf("/opt/homebrew/bin")).toBeLessThan(pathParts.indexOf("/usr/bin"));
    });

    test("windows: augments PATH and calls `where`", async () => {
      setPlatform("win32");
      process.env.PATH = "C:\\Windows\\System32;C:\\Windows";

      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "C:\\tools\\codex-acp.exe\r\n", "")
      );

      const found = await detectBinary("codex-acp");
      expect(found).toBe("C:\\tools\\codex-acp.exe");

      const [cmd, , opts] = execFileMock.mock.calls[0];
      expect(cmd).toBe("where");
      // A fresh env object (not process.env) with an augmented PATH, so the
      // GUI-app sparse PATH still reaches %APPDATA%\npm etc.
      expect(opts.env).not.toBe(process.env);
      expect(opts.env?.PATH).toContain("C:\\Windows\\System32");
    });

    test("windows: prefers the .exe over a sibling .cmd shim", async () => {
      setPlatform("win32");
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "C:\\npm\\codex-acp.cmd\r\nC:\\npm\\codex-acp.exe\r\n", "")
      );
      await expect(detectBinary("codex-acp")).resolves.toBe("C:\\npm\\codex-acp.exe");
    });

    test("windows: treats a .cmd-only result as not found (unspawnable over stdio)", async () => {
      setPlatform("win32");
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "C:\\npm\\codex-acp.cmd\r\nC:\\npm\\codex-acp.ps1\r\n", "")
      );
      await expect(detectBinary("codex-acp")).resolves.toBeNull();
    });

    test("windows: prefers the .exe over a sibling extensionless cmd-shim", async () => {
      setPlatform("win32");
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "C:\\npm\\codex-acp\r\nC:\\npm\\codex-acp.exe\r\n", "")
      );
      await expect(detectBinary("codex-acp")).resolves.toBe("C:\\npm\\codex-acp.exe");
    });

    test("windows: treats an extensionless cmd-shim-only result as not found", async () => {
      setPlatform("win32");
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "C:\\npm\\codex-acp\r\nC:\\npm\\codex-acp.ps1\r\n", "")
      );
      await expect(detectBinary("codex-acp")).resolves.toBeNull();
    });

    test("returns null when the lookup tool exits non-zero", async () => {
      setPlatform("darwin");
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(new Error("exit code 1"), "", "")
      );
      await expect(detectBinary("missing")).resolves.toBeNull();
    });

    test("returns only the first match when `which`/`where` print several", async () => {
      setPlatform("darwin");
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(null, "/opt/homebrew/bin/codex-acp\n/usr/local/bin/codex-acp\n", "")
      );
      await expect(detectBinary("codex-acp")).resolves.toBe("/opt/homebrew/bin/codex-acp");
    });

    test("does not require Node built-ins at module evaluation time", () => {
      // A module-scope promisify(execFile) dereferences an undefined module on
      // mobile and kills the plugin at load. Bare "child_process" is file-wide
      // mocked above so it stays benign here; an eager regression still
      // surfaces through "util" (module-scope promisify) or any node:-prefixed
      // static import.
      const throwingIds = [
        "util",
        "fs",
        "path",
        "os",
        "node:child_process",
        "node:util",
        "node:fs",
        "node:path",
        "node:os",
      ];
      try {
        jest.isolateModules(() => {
          for (const id of throwingIds) {
            jest.doMock(id, () => {
              throw new Error(`eager require of ${id}`);
            });
          }
          expect(() => void jest.requireActual("./detectBinary")).not.toThrow();
        });
      } finally {
        for (const id of throwingIds) jest.dontMock(id);
      }
    });

    test("rejects with the desktop-only error on non-desktop runtimes instead of a TypeError", async () => {
      const platform = Platform as { isMobile: boolean };
      platform.isMobile = true;
      try {
        await expect(detectBinary("codex-acp")).rejects.toThrow(/unavailable outside the desktop/);
        expect(execFileMock).not.toHaveBeenCalled();
      } finally {
        platform.isMobile = false;
      }
    });
  });

  describe("validateExecutableFile()", () => {
    test("rejects with the desktop-only error on non-desktop runtimes instead of a TypeError", async () => {
      const platform = Platform as { isMobile: boolean };
      platform.isMobile = true;
      try {
        await expect(validateExecutableFile("/usr/local/bin/tool")).rejects.toThrow(
          /unavailable outside the desktop/
        );
      } finally {
        platform.isMobile = false;
      }
    });
  });
});
