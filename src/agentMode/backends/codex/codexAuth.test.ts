import { detectBinary } from "@/utils/detectBinary";
jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { codexAuth } from "./codexAuth";
import { getSettings } from "@/settings/model";
import { signInWithCli } from "@/agentMode/backends/shared/cliSignIn";
const mockExec = jest.fn();
const mockSpawn = jest.fn();
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
