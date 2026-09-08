import { detectBinary } from "@/utils/detectBinary";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { codexAuth } from "./codexAuth";
import { getSettings } from "@/settings/model";

jest.mock("@/utils/detectBinary", () => ({ detectBinary: jest.fn() }));
const mockSpawn = jest.fn();
const mockExec = jest.fn();
jest.mock("./codexVersion", () => ({
  resolveSupportedCodexAcpEntry: (path: string) => path,
  buildCodexAcpInvocation: (command: string, args: string[], env: object) => ({
    command,
    args,
    env,
  }),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (id: string) =>
    id === "child_process"
      ? { execFile: mockExec, spawn: mockSpawn }
      : jest.requireActual(`node:${id}`),
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";
const settings = {
  ...getSettings(),
  agentMode: {
    ...getSettings().agentMode,
    backends: {
      codex: {
        binaryPath: "/bundle/codex-acp",
        envOverrides: { CODEX_HOME: "/my profile", OPENAI_API_KEY: "", CODEX_API_KEY: "" },
      },
    },
  },
};
const configured = (config: object) => ({
  ...settings,
  agentMode: {
    ...settings.agentMode,
    backends: { codex: { ...settings.agentMode.backends.codex, ...config } },
  },
});
const child = () =>
  Object.assign(new EventEmitter(), {
    pid: 987654,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

describe("codexAuth", () => {
  beforeEach(() => {
    mockSpawn.mockReset().mockImplementation(() => {
      const process = child();
      queueMicrotask(() => {
        process.stderr.write("Logged in using ChatGPT\n");
        process.emit("close", 0);
      });
      return process;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  describe("getProbeKey()", () => {
    it(`preserves managed login identity across same-version UUID replacements: ${ISSUE}`, () => {
      const original = configured({
        binaryPath: "/managed/uuid-a/codex-acp",
        binarySource: "managed",
        binaryVersion: "1.10.0-r1",
      });
      const replacement = configured({
        binaryPath: "/managed/uuid-b/codex-acp",
        binarySource: "managed",
        binaryVersion: "1.10.0-r1",
      });
      expect(codexAuth.getProbeKey!(original)).toBe(codexAuth.getProbeKey!(replacement));
    });
    it.each([
      { binaryPath: "" },
      { binaryPath: "/custom/other" },
      { envOverrides: { CODEX_HOME: "/other profile" } },
      { envOverrides: { CODEX_HOME: "/my profile", OPENAI_API_KEY: "fixture-key" } },
    ])(`invalidates changed account inputs without exposing them %j: ${ISSUE}`, (config) => {
      const key = codexAuth.getProbeKey!(configured(config));
      expect(key).not.toBe(codexAuth.getProbeKey!(settings));
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });
    it(`ignores environment property ordering: ${ISSUE}`, () => {
      expect(
        codexAuth.getProbeKey!(
          configured({ envOverrides: { CODEX_HOME: "/p", MODEL_PROVIDER: "test" } })
        )
      ).toBe(
        codexAuth.getProbeKey!(
          configured({ envOverrides: { MODEL_PROVIDER: "test", CODEX_HOME: "/p" } })
        )
      );
    });
  });
  describe("getStatus()", () => {
    it.each(["/bundle/codex-acp.exe", "C:/npm/codex-acp/dist/index.js"])(
      `only discovers Node for a Windows npm entry %s: ${ISSUE}`,
      async (binaryPath) => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: "win32" });
        jest.mocked(detectBinary).mockClear().mockResolvedValue("C:/node.exe");
        try {
          await codexAuth.getStatus(configured({ binaryPath }));
          expect(detectBinary).toHaveBeenCalledTimes(binaryPath.endsWith(".js") ? 1 : 0);
        } finally {
          Object.defineProperty(process, "platform", platform);
        }
      }
    );
    it.each(["Logged in using ChatGPT", "Logged in using an API key - fixture-secret"])(
      `reads CLI status without exposing credentials %s: ${ISSUE}`,
      async (line) => {
        mockSpawn.mockImplementation(() => {
          const process = child();
          queueMicrotask(() => {
            process.stderr.write(line + "\n");
            process.emit("close", 0);
          });
          return process;
        });
        await expect(codexAuth.getStatus(settings)).resolves.toEqual({ signedIn: true });
        expect(mockSpawn).toHaveBeenCalledWith(
          "/bundle/codex-acp",
          ["cli", "login", "status"],
          expect.objectContaining({
            env: expect.objectContaining({ CODEX_HOME: "/my profile" }),
            detached: process.platform !== "win32",
          })
        );
      }
    );
    it.each(["OPENAI_API_KEY", "CODEX_API_KEY"])(
      `recognizes environment authentication %s: ${ISSUE}`,
      async (key) => {
        await expect(
          codexAuth.getStatus(configured({ envOverrides: { [key]: "fixture-key" } }))
        ).resolves.toEqual({ signedIn: true });
        expect(mockSpawn).not.toHaveBeenCalled();
      }
    );
    it.each(["OPENAI_API_KEY", "CODEX_API_KEY"])(
      `recognizes inherited environment authentication %s: ${ISSUE}`,
      async (key) => {
        jest.replaceProperty(process, "env", { [key]: "fixture-key" });
        await expect(codexAuth.getStatus(configured({ envOverrides: {} }))).resolves.toEqual({
          signedIn: true,
        });
        expect(mockSpawn).not.toHaveBeenCalled();
      }
    );
    it(`treats failed status startup as signed out: ${ISSUE}`, async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error("failed");
      });
      await expect(codexAuth.getStatus(settings)).resolves.toEqual({ signedIn: false });
    });
    it.each(["darwin", "win32"] as const)(
      `stops the owned process tree before settling a timed-out status probe on %s: ${ISSUE}`,
      async (host) => {
        jest.useFakeTimers();
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: host });
        const processChild = child();
        mockSpawn.mockReturnValue(processChild);
        const kill = jest.spyOn(process, "kill").mockImplementation(() => {
          queueMicrotask(() => processChild.emit("close", 1));
          return true;
        });
        mockExec.mockReset().mockImplementation((_command, _args, _options, callback) => {
          callback(null);
          queueMicrotask(() => processChild.emit("close", 1));
        });
        try {
          const pending = codexAuth.getStatus(settings);
          await jest.advanceTimersByTimeAsync(10_000);
          await expect(pending).resolves.toEqual({ signedIn: false });
          if (host === "win32")
            expect(mockExec).toHaveBeenCalledWith(
              "taskkill",
              ["/PID", String(processChild.pid), "/T", "/F"],
              { windowsHide: true },
              expect.any(Function)
            );
          else expect(kill).toHaveBeenCalledWith(-processChild.pid, "SIGTERM");
        } finally {
          Object.defineProperty(process, "platform", platform);
        }
      }
    );
  });
  describe("signOut()", () => {
    it(`logs out and checks the configured adapter profile: ${ISSUE}`, async () => {
      mockSpawn.mockImplementation(() => {
        const process = child();
        queueMicrotask(() => {
          process.stderr.write("Not logged in\n");
          process.emit("close", 0);
        });
        return process;
      });
      await expect(codexAuth.signOut!(settings)).resolves.toEqual({ signedIn: false });
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        "/bundle/codex-acp",
        ["cli", "logout"],
        expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: "/my profile" }) })
      );
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        "/bundle/codex-acp",
        ["cli", "login", "status"],
        expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: "/my profile" }) })
      );
    });
    it.each(["startup failure", "unrecognized output"])(
      `rejects unverifiable status after logout exits successfully: %s ${ISSUE}`,
      async (failure) => {
        mockSpawn.mockImplementation((_command, args) => {
          if (args.includes("status") && failure === "startup failure")
            throw new Error("missing status CLI");
          const process = child();
          queueMicrotask(() => process.emit("close", 0));
          return process;
        });
        await expect(codexAuth.signOut!(settings)).rejects.toThrow("Sign-out did not complete");
        expect(mockSpawn).toHaveBeenCalledTimes(2);
      }
    );
    it(`rejects a timed-out status probe after successful logout: ${ISSUE}`, async () => {
      jest.useFakeTimers();
      const logout = child();
      const probe = child();
      mockSpawn.mockReturnValueOnce(logout).mockReturnValueOnce(probe);
      jest.spyOn(process, "kill").mockImplementation(() => {
        queueMicrotask(() => probe.emit("close", 1));
        return true;
      });
      mockExec.mockImplementation((_command, _args, _options, callback) => {
        callback(null);
        queueMicrotask(() => probe.emit("close", 1));
      });
      const pending = expect(codexAuth.signOut!(settings)).rejects.toThrow(
        "Sign-out did not complete"
      );
      await Promise.resolve();
      logout.emit("close", 0);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(10_000);
      await pending;
    });
    it(`preserves authenticated status when logout does not remove the account: ${ISSUE}`, async () => {
      await expect(codexAuth.signOut!(settings)).resolves.toEqual({ signedIn: true });
    });
    it(`does not claim environment credentials were removed by CLI logout: ${ISSUE}`, async () => {
      await expect(
        codexAuth.signOut!(configured({ envOverrides: { OPENAI_API_KEY: "fixture-key" } }))
      ).resolves.toEqual({ signedIn: true });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    it(`reports failed process startup without claiming successful sign-out: ${ISSUE}`, async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error("failed");
      });
      await expect(codexAuth.signOut!(settings)).rejects.toThrow("Sign-out did not complete");
    });
    it(`never starts a cancelled sign-out: ${ISSUE}`, async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(codexAuth.signOut!(settings, { signal: controller.signal })).rejects.toThrow(
        "Sign-out did not complete"
      );
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
  describe("signIn()", () => {
    it(`selects the OpenAI authorization URL and verifies status with the same profile: ${ISSUE}`, async () => {
      const onUrl = jest.fn();
      mockSpawn.mockImplementation((_command, args) => {
        const process = child();
        queueMicrotask(() => {
          process.stderr.write(
            args.includes("status")
              ? "Logged in using ChatGPT\n"
              : "Starting on http://localhost:1455\nhttps://auth.openai.com/oauth/authorize?client_id=test\n"
          );
          process.emit("close", 0);
        });
        return process;
      });
      await expect(codexAuth.signIn(settings, { onUrl })).resolves.toEqual({ signedIn: true });
      expect(onUrl).toHaveBeenCalledTimes(1);
      expect(onUrl).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?client_id=test");
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });
});
