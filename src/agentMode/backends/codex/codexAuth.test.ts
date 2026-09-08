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
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

const ACCOUNT = { type: "chatgpt", email: "zero@example.com", planType: "pro" };
const SIGNED_IN = { signedIn: true, label: "zero@example.com (pro)" };
const serve = (account: unknown = ACCOUNT) => {
  const proc = child();
  proc.stdin.on("data", (data) => {
    const request = JSON.parse(String(data));
    if (request.id !== undefined)
      queueMicrotask(() => {
        proc.stdout.write(
          JSON.stringify({ id: request.id, result: request.id === 0 ? {} : { account } }) + "\n"
        );
      });
  });
  proc.stdin.on("finish", () => queueMicrotask(() => proc.emit("close", 0)));
  return proc;
};

describe("codexAuth", () => {
  beforeEach(() => {
    mockSpawn.mockReset().mockImplementation((_command, args) => {
      if (args.includes("app-server")) return serve();
      const proc = child();
      queueMicrotask(() => proc.emit("close", 0));
      return proc;
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
    it.each([
      [ACCOUNT, SIGNED_IN],
      [
        { type: "chatgpt", email: "zero@example.com", planType: null },
        { signedIn: true, label: "zero@example.com" },
      ],
      [{ type: "chatgpt", email: null, planType: "pro" }, { signedIn: true }],
      [{ type: "apiKey", apiKey: "fixture-secret" }, { signedIn: true }],
      [null, { signedIn: false }],
    ])(
      `reads account identity without exposing credentials %j: ${ISSUE}`,
      async (account, expected) => {
        const proc = serve(account);
        const write = jest.spyOn(proc.stdin, "write");
        mockSpawn.mockReturnValue(proc);
        await expect(codexAuth.getStatus(settings)).resolves.toEqual(expected);
        expect(write.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
          {
            id: 0,
            method: "initialize",
            params: { clientInfo: { name: "obsidian_copilot", version: "1.0.0" } },
          },
          { method: "initialized" },
          { id: 1, method: "account/read", params: { refreshToken: false } },
        ]);
        expect(mockSpawn).toHaveBeenCalledWith(
          "/bundle/codex-acp",
          ["cli", "app-server"],
          expect.objectContaining({
            env: expect.objectContaining({ CODEX_HOME: "/my profile" }),
            detached: process.platform !== "win32",
          })
        );
      }
    );
    it(`ignores notifications and diagnostics while assembling a split account response: ${ISSUE}`, async () => {
      const proc = child();
      mockSpawn.mockReturnValue(proc);
      proc.stdin.on("data", (data) => {
        const request = JSON.parse(String(data));
        queueMicrotask(() => {
          if (request.id === 0) proc.stdout.write('{"id":0,"result":{}}\n');
          if (request.id === 1) {
            proc.stderr.write("diagnostic\n");
            proc.stdout.write('null\n{"method":"account/updated","params":{}}\n');
            proc.stdout.write('{"id":1,"result":{"account":');
            proc.stdout.write(JSON.stringify(ACCOUNT) + "}}\n");
          }
        });
      });
      proc.stdin.on("finish", () => proc.emit("close", 0));
      await expect(codexAuth.getStatus(settings)).resolves.toEqual(SIGNED_IN);
    });
    it.each([
      { id: 0, error: { message: "unsupported" } },
      { id: 1, error: { message: "failed" } },
      { id: 1, result: {} },
    ])(
      `does not treat failed or malformed account replies as authenticated: %j ${ISSUE}`,
      async (reply) => {
        const proc = child();
        mockSpawn.mockImplementation(() => {
          queueMicrotask(() => {
            proc.stdout.write(JSON.stringify(reply) + "\n");
            proc.emit("close", 0);
          });
          return proc;
        });
        await expect(codexAuth.getStatus(settings)).resolves.toEqual({ signedIn: false });
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
      mockSpawn.mockImplementation((_command, args) => {
        if (args.includes("app-server")) return serve(null);
        const proc = child();
        queueMicrotask(() => proc.emit("close", 0));
        return proc;
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
        ["cli", "app-server"],
        expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: "/my profile" }) })
      );
    });
    it.each(["startup failure", "unrecognized output"])(
      `rejects unverifiable status after logout exits successfully: %s ${ISSUE}`,
      async (failure) => {
        mockSpawn.mockImplementation((_command, args) => {
          if (args.includes("app-server") && failure === "startup failure")
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
      await expect(codexAuth.signOut!(settings)).resolves.toEqual(SIGNED_IN);
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
        if (args.includes("app-server")) return serve();
        const proc = child();
        queueMicrotask(() => {
          proc.stderr.write(
            "Starting on http://localhost:1455\nhttps://auth.openai.com/oauth/authorize?client_id=test\n"
          );
          proc.emit("close", 0);
        });
        return proc;
      });
      await expect(codexAuth.signIn(settings, { onUrl })).resolves.toEqual(SIGNED_IN);
      expect(onUrl).toHaveBeenCalledTimes(1);
      expect(onUrl).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?client_id=test");
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });
});
