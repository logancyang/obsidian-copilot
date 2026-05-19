import { promisify } from "node:util";

import { detectBinary } from "./detectBinary";

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
type ExecFileArgs = [
  string,
  readonly string[],
  { timeout?: number; env?: NodeJS.ProcessEnv },
  ExecFileCallback,
];

const execFileMock = jest.fn<void, ExecFileArgs>();

jest.mock("node:child_process", () => {
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

  test("windows: leaves PATH untouched and calls `where`", async () => {
    setPlatform("win32");
    process.env.PATH = "C:\\Windows\\System32;C:\\Windows";

    execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
      cb(null, "C:\\tools\\codex-acp.exe\r\n", "")
    );

    const found = await detectBinary("codex-acp");
    expect(found).toBe("C:\\tools\\codex-acp.exe");

    const [cmd, , opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("where");
    // On Windows we hand the inherited env through unchanged.
    expect(opts.env).toBe(process.env);
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
});
