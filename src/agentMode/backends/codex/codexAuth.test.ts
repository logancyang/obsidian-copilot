import { detectBinary } from "@/utils/detectBinary";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { codexAuth } from "./codexAuth";
import { getSettings, setSettings } from "@/settings/model";
import { codexBinaryManager } from "./CodexBinaryManager";
import { installCodexArchive } from "./codexArchive";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
jest.mock("./codexArchive", () => ({
  ...jest.requireActual("./codexArchive"),
  installCodexArchive: jest.fn(),
}));

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
    it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/380 treats failed status startup as signed out and releases the reservation: ${ISSUE}`, async () => {
      const release = jest.fn();
      const reserve = jest.spyOn(codexBinaryManager, "reserveBinary").mockReturnValue(release);
      mockSpawn.mockImplementation(() => {
        expect(reserve).toHaveBeenCalledWith("/bundle/codex-acp");
        expect(release).not.toHaveBeenCalled();
        throw new Error("failed");
      });
      await expect(codexAuth.getStatus(settings)).resolves.toEqual({ signedIn: false });
      expect(release).toHaveBeenCalledTimes(1);
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
  describe("signIn()", () => {
    it.each([
      ["default", "file"],
      ["default", "keyring"],
      ["custom", "file"],
      ["custom", "keyring"],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 preserves the %s profile and %s credential store for native and user-owned npm adapters",
      async (profile, store) => {
        const originalHome = process.env.CODEX_HOME;
        delete process.env.CODEX_HOME;
        const envOverrides: Record<string, string> = {
          CODEX_CONFIG: JSON.stringify({ cli_auth_credentials_store: store }),
          OPENAI_API_KEY: "",
          CODEX_API_KEY: "",
        };
        if (profile === "custom") envOverrides.CODEX_HOME = "/fixture profile";
        try {
          for (const binaryPath of ["/npm/codex-acp/dist/index.js", "/managed/codex-acp"]) {
            await expect(
              codexAuth.signIn(configured({ binaryPath, envOverrides }))
            ).resolves.toEqual({ signedIn: true });
            const env = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1][2].env;
            expect(env.CODEX_HOME).toBe(profile === "custom" ? "/fixture profile" : undefined);
            expect(JSON.parse(env.CODEX_CONFIG).cli_auth_credentials_store).toBe(store);
          }
        } finally {
          if (originalHome === undefined) delete process.env.CODEX_HOME;
          else process.env.CODEX_HOME = originalHome;
        }
      }
    );
    it.each(["default", "custom"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 releases the %s profile reservation after login startup fails",
      async (profile) => {
        const release = jest.fn();
        jest.spyOn(codexBinaryManager, "reserveBinary").mockReturnValue(release);
        const envOverrides = { CODEX_HOME: profile === "custom" ? "/fixture profile" : undefined };
        mockSpawn.mockImplementation(() => {
          expect(release).not.toHaveBeenCalled();
          throw new Error("spawn failed");
        });
        await expect(codexAuth.signIn(configured({ envOverrides }))).resolves.toEqual({
          signedIn: false,
        });
        expect(release).toHaveBeenCalledTimes(1);
      }
    );
    it.each(["success", "failure"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 holds the reservation after cancellation until the status child exits with %s",
      async (outcome) => {
        const release = jest.fn();
        jest.spyOn(codexBinaryManager, "reserveBinary").mockReturnValue(release);
        const abort = new AbortController();
        const loginChild = child();
        const statusChild = child();
        let started!: () => void;
        let probing!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const statusReady = new Promise<void>((resolve) => {
          probing = resolve;
        });
        mockSpawn
          .mockImplementationOnce(() => {
            started();
            return loginChild;
          })
          .mockImplementationOnce(() => {
            probing();
            return statusChild;
          });
        const login = codexAuth.signIn(settings, { signal: abort.signal });
        await ready;
        loginChild.emit("close", 0);
        await statusReady;
        abort.abort();
        await Promise.resolve();
        await Promise.resolve();
        expect(release).not.toHaveBeenCalled();
        if (outcome === "success") statusChild.stderr.write("Logged in using ChatGPT\n");
        statusChild.emit("close", outcome === "success" ? 0 : 1);
        await expect(login).resolves.toEqual({ signedIn: false });
        expect(release).toHaveBeenCalledTimes(1);
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 completes login during reinstall using its captured bundle without reacquiring a reservation", async () => {
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
      setSettings({ agentMode: configured({ binaryPath, binarySource: "managed" }).agentMode });
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
      const loginChild = child();
      const statusChild = child();
      let started!: () => void;
      let probing!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const statusReady = new Promise<void>((resolve) => {
        probing = resolve;
      });
      mockSpawn
        .mockImplementationOnce(() => {
          started();
          return loginChild;
        })
        .mockImplementationOnce(() => {
          probing();
          return statusChild;
        });
      let install: Promise<unknown> | undefined;
      try {
        const login = codexAuth.signIn(getSettings());
        await ready;
        install = codexBinaryManager.install().catch((error) => error);
        await downloading;
        loginChild.emit("close", 0);
        await statusReady;
        await expect(codexBinaryManager.uninstall()).rejects.toThrow("Close Codex sessions");
        expect(mockSpawn).toHaveBeenLastCalledWith(
          binaryPath,
          ["cli", "login", "status"],
          expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: "/my profile" }) })
        );
        statusChild.stderr.write("Logged in using ChatGPT\n");
        statusChild.emit("close", 0);
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
