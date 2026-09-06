import { detectBinary } from "@/utils/detectBinary";
jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installCodexArchive } from "./codexArchive";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { codexBinaryManager } from "./CodexBinaryManager";
import { codexAuth } from "./codexAuth";
import { getSettings, setSettings } from "@/settings/model";
import { signInWithCli } from "@/agentMode/backends/shared/cliSignIn";
const mockExec = jest.fn();
const mockSpawn = jest.fn();
jest.mock("./codexArchive", () => ({
  ...jest.requireActual("./codexArchive"),
  installCodexArchive: jest.fn(),
}));
jest.mock("./codexVersion", () => ({
  resolveSupportedCodexAcpEntry: (path: string) => path,
  buildCodexAcpInvocation: (command: string, args: string[], env: object) => ({
    command,
    args,
    env,
  }),
}));
jest.mock("@/agentMode/backends/shared/cliSignIn", () => ({ signInWithCli: jest.fn() }));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) =>
    id === "child_process"
      ? { execFile: mockExec, spawn: mockSpawn }
      : id === "util"
        ? { promisify: () => mockExec }
        : jest.requireActual(`node:${id}`),
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";
describe("codexAuth", () => {
  const settings = {
    ...getSettings(),
    agentMode: {
      ...getSettings().agentMode,
      backends: {
        codex: { binaryPath: "/bundle/codex-acp", envOverrides: { CODEX_HOME: "/my profile" } },
      },
    },
  };
  beforeEach(() => mockExec.mockReset());
  describe("getStatus()", () => {
    it.each(["/bundle/codex-acp.exe", "C:/npm/codex-acp/dist/index.js"])(
      `only discovers Node for a user-owned Windows npm entry %s: ${ISSUE}`,
      async (binaryPath) => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: "win32" });
        jest.mocked(detectBinary).mockClear().mockResolvedValue("C:/node.exe");
        mockExec.mockResolvedValue({ stdout: "", stderr: "Logged in using ChatGPT" });
        try {
          await codexAuth.getStatus({
            ...settings,
            agentMode: { ...settings.agentMode, backends: { codex: { binaryPath } } },
          });
          expect(detectBinary).toHaveBeenCalledTimes(binaryPath.endsWith(".js") ? 1 : 0);
        } finally {
          Object.defineProperty(process, "platform", platform);
        }
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 releases the profile status binary after child failure", async () => {
      const release = jest.fn();
      const reserve = jest.spyOn(codexBinaryManager, "reserveBinary").mockReturnValue(release);
      mockExec.mockImplementationOnce(async () => {
        expect(reserve).toHaveBeenCalledWith("/bundle/codex-acp");
        expect(release).not.toHaveBeenCalled();
        throw new Error("spawn failed");
      });
      try {
        await codexAuth.getStatus(settings);
        expect(release).toHaveBeenCalledTimes(1);
      } finally {
        reserve.mockRestore();
      }
    });

    it.each(["Logged in using ChatGPT", "Logged in using an API key - sk-secret"])(
      `reads %s from authoritative CLI status without exposing credentials: ${ISSUE}`,
      async (stderr) => {
        mockExec.mockResolvedValue({ stdout: "", stderr });
        await expect(codexAuth.getStatus(settings)).resolves.toEqual({ signedIn: true });
        expect(mockExec).toHaveBeenCalledWith(
          "/bundle/codex-acp",
          ["cli", "login", "status"],
          expect.objectContaining({
            env: expect.objectContaining({ CODEX_HOME: "/my profile" }),
            windowsHide: true,
          })
        );
      }
    );
    it.each(["failure", "unknown"])(`treats %s status as signed out: ${ISSUE}`, async (fault) => {
      if (fault === "failure") mockExec.mockRejectedValue(new Error("timeout"));
      else mockExec.mockResolvedValue({ stdout: "", stderr: "" });
      await expect(codexAuth.getStatus(settings)).resolves.toEqual({ signedIn: false });
    });
  });
  describe("signIn()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 completes login during a pending reinstall without reacquiring its held reservation", async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-login-reinstall-"));
      const binaryPath = path.join(
        directory,
        "1.10.0-r1-12345678-1234-4123-8123-123456789abc",
        "codex-acp"
      );
      fs.mkdirSync(path.dirname(binaryPath));
      fs.writeFileSync(binaryPath, "fixture adapter");
      const dataDir = jest.spyOn(codexBinaryManager, "getDataDir").mockReturnValue(directory);
      const original = getSettings().agentMode;
      setSettings((current) => ({
        agentMode: {
          ...current.agentMode,
          backends: {
            ...current.agentMode.backends,
            codex: {
              binaryPath,
              binarySource: "managed",
              envOverrides: { CODEX_HOME: "/fixture profile" },
            },
          },
        },
      }));
      let rejectDownload!: (error: Error) => void;
      let downloadStarted!: () => void;
      const downloading = new Promise<void>((resolve) => {
        downloadStarted = resolve;
      });
      jest.mocked(installCodexArchive).mockImplementationOnce(() => {
        downloadStarted();
        return new Promise((_resolve, reject) => {
          rejectDownload = reject;
        });
      });
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      mockSpawn.mockReturnValue(child);
      const realSignIn = jest.requireActual<typeof import("@/agentMode/backends/shared/cliSignIn")>(
        "@/agentMode/backends/shared/cliSignIn"
      ).signInWithCli;
      let loginStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        loginStarted = resolve;
      });
      jest.mocked(signInWithCli).mockImplementationOnce((...args) => {
        const controller = realSignIn(...args);
        loginStarted();
        return controller;
      });
      let releaseStatus!: (value: { stdout: string; stderr: string }) => void;
      mockExec.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseStatus = resolve;
          })
      );
      let install: Promise<unknown> | undefined;
      try {
        const login = codexAuth.signIn(getSettings());
        await started;
        install = codexBinaryManager.install().catch((error) => error);
        await downloading;
        child.emit("close", 0);
        await expect(codexBinaryManager.uninstall()).rejects.toThrow("Close Codex sessions");
        expect(mockExec).toHaveBeenCalledWith(
          binaryPath,
          ["cli", "login", "status"],
          expect.objectContaining({
            env: expect.objectContaining({ CODEX_HOME: "/fixture profile" }),
          })
        );
        releaseStatus({ stdout: "", stderr: "Logged in using ChatGPT" });
        await expect(login).resolves.toEqual({ signedIn: true });
        expect(codexBinaryManager.isBusy()).toBe(true);
      } finally {
        rejectDownload?.(new Error("fixture interrupted download"));
        await install;
        dataDir.mockRestore();
        setSettings({ agentMode: original });
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    it.each(["default", "custom"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 retains the %s profile and reserves the adapter until sign-in ends",
      async (profile) => {
        const release = jest.fn();
        const reserve = jest.spyOn(codexBinaryManager, "reserveBinary").mockReturnValue(release);
        const envOverrides: Record<string, string> = {
          CODEX_CONFIG: '{"cli_auth_credentials_store":"keyring"}',
        };
        if (profile === "custom") envOverrides.CODEX_HOME = "/my profile";
        const current = {
          ...settings,
          agentMode: {
            ...settings.agentMode,
            backends: { codex: { binaryPath: "/bundle/codex-acp", envOverrides } },
          },
        };
        jest.mocked(signInWithCli).mockImplementationOnce((_command, _args, env) => {
          expect(env.CODEX_HOME).toBe(
            profile === "custom" ? "/my profile" : process.env.CODEX_HOME
          );
          expect(env.CODEX_CONFIG).toBe(envOverrides.CODEX_CONFIG);
          expect(release).not.toHaveBeenCalled();
          return { done: Promise.reject(new Error("cancelled")), cancel: jest.fn() };
        });
        try {
          await expect(codexAuth.signIn(current, { onUrl: jest.fn() })).rejects.toThrow(
            "cancelled"
          );
          expect(release).toHaveBeenCalledTimes(1);
        } finally {
          reserve.mockRestore();
        }
      }
    );

    it(`selects OpenAI authorization after the printed localhost server URL: ${ISSUE}`, async () => {
      const onUrl = jest.fn();
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      mockSpawn.mockReturnValue(child);
      mockExec.mockResolvedValue({ stdout: "", stderr: "Not logged in" });
      const realSignIn = jest.requireActual<typeof import("@/agentMode/backends/shared/cliSignIn")>(
        "@/agentMode/backends/shared/cliSignIn"
      ).signInWithCli;
      jest.mocked(signInWithCli).mockImplementation((...args) => {
        const controller = realSignIn(...args);
        child.stderr.write(
          "Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback\n"
        );
        child.emit("close", 0);
        return controller;
      });
      await codexAuth.signIn(settings, { onUrl });
      expect(onUrl).toHaveBeenCalledWith(
        "https://auth.openai.com/oauth/authorize?response_type=code&client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback"
      );
      expect(onUrl).toHaveBeenCalledTimes(1);
    });
    it(`uses Claude's login lifecycle with the runtime profile and post-login status: ${ISSUE}`, async () => {
      mockExec.mockResolvedValue({ stdout: "", stderr: "Logged in using ChatGPT" });
      jest.mocked(signInWithCli).mockImplementation((_path, _args, _env, status) => ({
        done: status(),
        cancel: jest.fn(),
      }));
      await expect(codexAuth.signIn(settings)).resolves.toEqual({ signedIn: true });
      expect(signInWithCli).toHaveBeenCalledWith(
        "/bundle/codex-acp",
        ["cli", "login"],
        expect.objectContaining({ CODEX_HOME: "/my profile" }),
        expect.any(Function),
        expect.objectContaining({ acceptUrl: expect.any(Function) })
      );
    });
  });
});
