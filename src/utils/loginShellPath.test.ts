import { promisify } from "node:util";

import type * as LoginShellPath from "./loginShellPath";

const ISSUE_4096 = "https://github.com/logancyang/obsidian-copilot/issues/4096";
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
interface ExecFileOptions {
  timeout?: number;
  killSignal?: string;
}
type ExecFileArgs = [string, readonly string[], ExecFileOptions, ExecFileCallback];

const execFileMock = jest.fn<void, ExecFileArgs>();

jest.mock("child_process", () => {
  const fn = (...args: ExecFileArgs): void => execFileMock(...args);
  (fn as unknown as Record<symbol, unknown>)[promisify.custom] = (
    cmd: string,
    args: readonly string[],
    options: ExecFileOptions
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      execFileMock(cmd, args, options, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { execFile: fn };
});

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

function freshModule(): typeof LoginShellPath {
  let mod!: typeof LoginShellPath;
  jest.isolateModules(() => {
    mod = jest.requireActual<typeof LoginShellPath>("./loginShellPath");
  });
  return mod;
}

function freshAgentShellPath(): typeof LoginShellPath.agentShellPath {
  return freshModule().agentShellPath;
}

function loginShellPrints(stdout: string): void {
  execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
    const marker = /echo (\S+);/.exec(args[args.length - 1])?.[1] ?? "";
    cb(null, stdout.split("<marker>").join(marker), "");
  });
}

describe("loginShellPath", () => {
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    execFileMock.mockReset();
    process.env.PATH = LAUNCHD_PATH;
    process.env.SHELL = "/bin/zsh";
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
  });

  describe("loginShellPathDirs()", () => {
    it(`returns only the login shell's PATH dirs, in order, so detection can search them first (https://github.com/Brevilabs/obsidian-copilot-private/issues/873)`, async () => {
      loginShellPrints("<marker>\n/Users/me/.local/share/mise/shims:/usr/bin\n<marker>\n");

      await expect(freshModule().loginShellPathDirs()).resolves.toEqual([
        "/Users/me/.local/share/mise/shims",
        "/usr/bin",
      ]);
    });

    it("returns no dirs when the login shell fails", async () => {
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(new Error("Command failed"), "", "")
      );

      await expect(freshModule().loginShellPathDirs()).resolves.toEqual([]);
    });

    it("shares one login-shell lookup with agentShellPath()", async () => {
      loginShellPrints("<marker>\n/usr/local/bin\n<marker>\n");
      const mod = freshModule();

      await mod.loginShellPathDirs();
      await mod.agentShellPath();

      expect(execFileMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("agentShellPath()", () => {
    it(`puts the user's login-shell PATH ahead of Obsidian's, so an agent finds the commands a terminal finds (${ISSUE_4096})`, async () => {
      loginShellPrints("<marker>\n/usr/local/bin:/Users/me/.nvm/bin:/usr/bin\n<marker>\n");

      await expect(freshAgentShellPath()()).resolves.toBe(
        "/usr/local/bin:/Users/me/.nvm/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      );
      const [shell, args] = execFileMock.mock.calls[0];
      expect(shell).toBe("/bin/zsh");
      expect(args).toEqual(expect.arrayContaining(["-i", "-l", "-c"]));
    });

    it("ignores whatever the user's startup files print around the PATH", async () => {
      loginShellPrints("Welcome to fish!\n<marker>\n/opt/homebrew/bin:/usr/bin\n<marker>\nbye\n");

      await expect(freshAgentShellPath()()).resolves.toBe(
        "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      );
    });

    it("keeps Obsidian's PATH when the login shell fails or times out", async () => {
      execFileMock.mockImplementation((_cmd, _args, _opts, cb) =>
        cb(new Error("Command failed: timed out"), "", "")
      );

      await expect(freshAgentShellPath()()).resolves.toBe(LAUNCHD_PATH);
    });

    it(`stops a stuck login shell with a signal interactive Bash cannot ignore, so agent starts never hang (${ISSUE_4096})`, async () => {
      loginShellPrints("<marker>\n/usr/local/bin\n<marker>\n");

      await freshAgentShellPath()();

      const [, , options] = execFileMock.mock.calls[0];
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.killSignal).toBe("SIGKILL");
    });

    it("asks the login shell once and reuses its PATH for every later agent", async () => {
      loginShellPrints("<marker>\n/usr/local/bin\n<marker>\n");
      const agentShellPath = freshAgentShellPath();

      await agentShellPath();
      await agentShellPath();

      expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it("keeps Obsidian's PATH on Windows, where apps already inherit the user's PATH", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      await expect(freshAgentShellPath()()).resolves.toBe(LAUNCHD_PATH);
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });
});
