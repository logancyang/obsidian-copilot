import { Platform } from "obsidian";
import {
  buildObsidianCliArgs,
  runRandomReadCommand,
  runObsidianCliCommand,
} from "@/services/obsidianCli/ObsidianCliClient";

/**
 * Callback signature used by mocked execFile in tests.
 */
type MockExecCallback = (
  error: (Error & { code?: string | number | null; signal?: string | null }) | null,
  stdout: string,
  stderr: string
) => void;

/**
 * ExecFile argument shape for typed jest mocks.
 */
type MockExecArgs = [
  binary: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
  callback: MockExecCallback,
];

/**
 * Runtime require container shape for tests.
 */
interface TestRequireContainer {
  require?: (id: string) => unknown;
}

describe("ObsidianCliClient", () => {
  let originalRequire: ((id: string) => unknown) | undefined;

  beforeEach(() => {
    const platform = Platform as unknown as { isDesktopApp?: boolean; isDesktop?: boolean };
    platform.isDesktopApp = true;

    const container = globalThis as unknown as TestRequireContainer;
    originalRequire = container.require;
  });

  afterEach(() => {
    const container = globalThis as unknown as TestRequireContainer;
    if (originalRequire) {
      container.require = originalRequire;
    } else {
      delete container.require;
    }
    jest.clearAllMocks();
  });

  test("buildObsidianCliArgs keeps vault before command and serializes params", () => {
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

  test("runObsidianCliCommand returns successful process payload", async () => {
    const execFileMock = jest.fn<void, MockExecArgs>((_binary, _args, _options, callback) =>
      callback(null, "Daily note content", "")
    );

    const container = globalThis as unknown as TestRequireContainer;
    container.require = jest.fn((id: string) => {
      if (id === "child_process") {
        return { execFile: execFileMock };
      }
      return {};
    });

    const result = await runObsidianCliCommand({
      command: "daily:read",
      vault: "Work",
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("daily:read");
    expect(result.args).toEqual(["vault=Work", "daily:read"]);
    expect(result.stdout).toBe("Daily note content");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  test("runObsidianCliCommand captures process failure output", async () => {
    const execFileMock = jest.fn<void, MockExecArgs>((_binary, _args, _options, callback) => {
      const error = new Error("spawn ENOENT") as Error & {
        code?: string | number | null;
        signal?: string | null;
      };
      error.code = "ENOENT";
      callback(error, "", "command not found");
    });

    const container = globalThis as unknown as TestRequireContainer;
    container.require = jest.fn((id: string) => {
      if (id === "child_process") {
        return { execFile: execFileMock };
      }
      return {};
    });

    const result = await runObsidianCliCommand({
      command: "daily:read",
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("ENOENT");
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toBe("command not found");
    expect(result.attemptedBinaries).toEqual([
      "obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
    ]);
  });

  test("runObsidianCliCommand falls back to app binary when default binary is missing", async () => {
    const execFileMock = jest.fn<void, MockExecArgs>((binary, _args, _options, callback) => {
      if (binary === "obsidian") {
        const error = new Error("spawn ENOENT") as Error & {
          code?: string | number | null;
          signal?: string | null;
        };
        error.code = "ENOENT";
        callback(error, "", "");
        return;
      }

      if (binary === "/Applications/Obsidian.app/Contents/MacOS/obsidian") {
        callback(null, "Recovered via fallback binary", "");
        return;
      }

      const error = new Error("spawn ENOENT") as Error & {
        code?: string | number | null;
        signal?: string | null;
      };
      error.code = "ENOENT";
      callback(error, "", "");
    });

    const container = globalThis as unknown as TestRequireContainer;
    container.require = jest.fn((id: string) => {
      if (id === "child_process") {
        return { execFile: execFileMock };
      }
      return {};
    });

    const result = await runObsidianCliCommand({
      command: "random:read",
    });

    expect(result.ok).toBe(true);
    expect(result.binary).toBe("/Applications/Obsidian.app/Contents/MacOS/obsidian");
    expect(result.attemptedBinaries).toEqual([
      "obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/obsidian",
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  test("runRandomReadCommand executes random:read wrapper", async () => {
    const execFileMock = jest.fn<void, MockExecArgs>((_binary, _args, _options, callback) =>
      callback(null, "Random note content", "")
    );

    const container = globalThis as unknown as TestRequireContainer;
    container.require = jest.fn((id: string) => {
      if (id === "child_process") {
        return { execFile: execFileMock };
      }
      return {};
    });

    const result = await runRandomReadCommand("Personal");

    expect(result.ok).toBe(true);
    expect(result.command).toBe("random:read");
    expect(result.args).toEqual(["vault=Personal", "random:read"]);
    expect(result.stdout).toBe("Random note content");
  });

  test("runObsidianCliCommand rejects on non-desktop runtime", async () => {
    const platform = Platform as unknown as { isDesktopApp?: boolean; isDesktop?: boolean };
    platform.isDesktopApp = false;
    platform.isDesktop = false;

    await expect(
      runObsidianCliCommand({
        command: "daily:read",
      })
    ).rejects.toThrow("only supported in desktop Obsidian");
  });
});
