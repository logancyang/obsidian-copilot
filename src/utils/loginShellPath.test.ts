import { promisify } from "node:util";

import type { agentShellPath as AgentShellPath } from "./loginShellPath";

const ISSUE_4096 = "https://github.com/logancyang/obsidian-copilot/issues/4096";
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
type ExecFileArgs = [string, readonly string[], { timeout?: number }, ExecFileCallback];

const execFileMock = jest.fn<void, ExecFileArgs>();

jest.mock("child_process", () => {
  const fn = (...args: ExecFileArgs): void => execFileMock(...args);
  (fn as unknown as Record<symbol, unknown>)[promisify.custom] = (
    cmd: string,
    args: readonly string[],
    options: { timeout?: number }
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

function freshAgentShellPath(): typeof AgentShellPath {
  let fn!: typeof AgentShellPath;
  jest.isolateModules(() => {
    fn = jest.requireActual<typeof import("./loginShellPath")>("./loginShellPath").agentShellPath;
  });
  return fn;
}

function loginShellPrints(stdout: string): void {
  execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
    const marker = /echo (\S+);/.exec(args[args.length - 1])?.[1] ?? "";
    cb(null, stdout.split("<marker>").join(marker), "");
  });
}

describe("loginShellPath", () => {
  describe("agentShellPath()", () => {
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
