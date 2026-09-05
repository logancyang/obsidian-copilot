import { getSettings, setSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import type * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CodexBinaryManager } from "./CodexBinaryManager";
import { CODEX_ACP_PINNED_VERSION } from "./cliSetup";

jest.mock("@/utils/detectBinary", () => ({
  ...jest.requireActual("@/utils/detectBinary"),
  detectBinary: jest.fn(),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/utils/desktopRuntime", () => {
  const actual = jest.requireActual<object>("@/utils/desktopRuntime");
  const child = { execFile: jest.fn() };
  const mockedOs = { ...jest.requireActual<object>("node:os"), homedir: jest.fn() };
  return {
    ...actual,
    requireNodeModule: (id: string) => {
      if (id === "child_process") return child;
      if (id === "os") return mockedOs;
      return jest.requireActual(`node:${id}`);
    },
  };
});

const mockedDetectBinary = jest.mocked(detectBinary);
const mockedHomedir = jest.mocked(requireNodeModule<typeof import("node:os")>("os").homedir);
const mockedExecFile = jest.mocked(
  requireNodeModule<typeof import("node:child_process")>("child_process").execFile
);
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
}

function writeAdapter(prefix: string, version = CODEX_ACP_PINNED_VERSION): string {
  const root = path.join(prefix, "node_modules", "@agentclientprotocol", "codex-acp");
  const entry = path.join(root, "dist", "index.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "#!/usr/bin/env node\n");
  fs.chmodSync(entry, 0o755);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@agentclientprotocol/codex-acp",
      version,
      bin: { "codex-acp": "dist/index.js" },
    })
  );
  return entry;
}

describe("CodexBinaryManager", () => {
  describe("CodexBinaryManager", () => {
    let tempDir: string;
    let originalAgentMode: ReturnType<typeof getSettings>["agentMode"];

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-managed-test-"));
      mockedHomedir.mockReturnValue(tempDir);
      mockedExecFile.mockReset();
      mockedDetectBinary.mockReset().mockResolvedValue("/usr/bin/npm");
      originalAgentMode = getSettings().agentMode;
      setPlatform("darwin");
    });

    afterEach(() => {
      setSettings({ agentMode: originalAgentMode });
      setPlatform(originalPlatform);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe("install()", () => {
      it.each(["success", "failure", "custom", "external"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/368 cleans up only a replaced managed version after %s",
        async (outcome) => {
          const manager = new CodexBinaryManager();
          const previousDir = path.join(
            outcome === "external" ? tempDir : manager.getDataDir(),
            "1.9.0"
          );
          const previousEntry = writeAdapter(previousDir, "1.9.0");
          setSettings((current) => ({
            agentMode: {
              ...current.agentMode,
              backends: {
                ...current.agentMode.backends,
                codex: {
                  binaryPath: previousEntry,
                  binaryVersion: "1.9.0",
                  binarySource: outcome === "custom" ? "custom" : "managed",
                },
              },
            },
          }));
          mockedExecFile.mockImplementation((command, args, _options, callback) => {
            const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
            if (outcome === "failure") cb(new Error("download failed"), "", "");
            else if (command === "/usr/bin/npm") {
              writeAdapter(args?.[args.indexOf("--prefix") + 1] as string);
              cb(null, "", "");
            } else cb(null, CODEX_ACP_PINNED_VERSION, "");
            return {} as childProcess.ChildProcess;
          });
          if (outcome === "failure") {
            await expect(manager.install()).rejects.toThrow("download failed");
            expect(getSettings().agentMode.backends?.codex?.binaryPath).toBe(previousEntry);
          } else {
            await manager.install();
            expect(getSettings().agentMode.backends?.codex?.binaryVersion).toBe(
              CODEX_ACP_PINNED_VERSION
            );
          }
          expect(fs.existsSync(previousEntry)).toBe(outcome !== "success");
        }
      );

      it("installs the exact package into the OS-local version directory and publishes shared state", async () => {
        mockedExecFile.mockImplementation((command, args, _options, callback) => {
          const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
          if (command === "/usr/bin/npm") {
            const prefix = args?.[args.indexOf("--prefix") + 1] as string;
            writeAdapter(prefix);
            cb(null, "", "");
          } else {
            cb(null, `@agentclientprotocol/codex-acp ${CODEX_ACP_PINNED_VERSION}`, "");
          }
          return {} as childProcess.ChildProcess;
        });
        const manager = new CodexBinaryManager();
        const listener = jest.fn();
        const unsubscribe = manager.subscribeRuntimeState(listener);

        expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
        expect(manager.getActionState()).toEqual({ kind: "idle" });
        await manager.install();

        const configured = getSettings().agentMode.backends?.codex;
        expect(configured).toMatchObject({
          binaryVersion: CODEX_ACP_PINNED_VERSION,
          binarySource: "managed",
        });
        expect(configured?.binaryPath).toBe(
          path.join(
            manager.getDataDir(),
            CODEX_ACP_PINNED_VERSION,
            "node_modules",
            "@agentclientprotocol",
            "codex-acp",
            "dist",
            "index.js"
          )
        );
        expect(fs.existsSync(path.join(manager.getDataDir(), CODEX_ACP_PINNED_VERSION))).toBe(true);
        const npmArgs = mockedExecFile.mock.calls[0]?.[1] ?? [];
        expect(npmArgs).toContain(`@agentclientprotocol/codex-acp@${CODEX_ACP_PINNED_VERSION}`);
        expect(npmArgs).toContain("--prefix");
        expect(npmArgs).not.toContain("-g");
        expect(npmArgs).not.toContain("--global");
        expect(listener).toHaveBeenCalled();
        expect(manager.getActionState()).toEqual({ kind: "idle" });
        unsubscribe();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 rejects a non-pinned package without replacing a custom adapter", async () => {
        setSettings((current) => ({
          agentMode: {
            ...current.agentMode,
            backends: {
              ...current.agentMode.backends,
              codex: {
                binaryPath: "/user/codex-acp",
                binaryVersion: "1.9.0",
                binarySource: "custom",
              },
            },
          },
        }));
        mockedExecFile.mockImplementation((_command, args, _options, callback) => {
          const prefix = args?.[args.indexOf("--prefix") + 1] as string;
          writeAdapter(prefix, "1.9.0");
          (callback as (error: Error | null, stdout: string, stderr: string) => void)(null, "", "");
          return {} as childProcess.ChildProcess;
        });
        const manager = new CodexBinaryManager();

        await expect(manager.install()).rejects.toThrow("npm installed");
        expect(getSettings().agentMode.backends?.codex).toMatchObject({
          binaryPath: "/user/codex-acp",
          binarySource: "custom",
        });
        expect(manager.getActionState()).toMatchObject({ kind: "error" });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 launches a globally upgraded Windows npm using independently detected Node", async () => {
        setPlatform("win32");
        mockedDetectBinary.mockResolvedValue("C:\\Program Files\\nodejs\\node.exe");
        mockedExecFile.mockImplementation((command, args, _options, callback) => {
          const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
          if (command === "where")
            cb(null, "C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd\r\n", "");
          else cb(new Error("stop after npm launch"), "", "");
          return {} as childProcess.ChildProcess;
        });
        const manager = new CodexBinaryManager();

        await expect(manager.install()).rejects.toThrow("stop after npm launch");
        expect(mockedExecFile.mock.calls[0]?.slice(0, 2)).toEqual(["where", ["npm"]]);
        expect(mockedExecFile.mock.calls[1]?.[0]).toBe("C:\\Program Files\\nodejs\\node.exe");
        expect(mockedExecFile.mock.calls[1]?.[1]?.[0]).toBe(
          "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js"
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 explains missing Node when a Windows npm shim is found", async () => {
        setPlatform("win32");
        mockedDetectBinary.mockResolvedValue(null);
        mockedExecFile.mockImplementation((_command, _args, _options, callback) => {
          (callback as (error: Error | null, stdout: string, stderr: string) => void)(
            null,
            "C:\\npm\\npm.cmd",
            ""
          );
          return {} as childProcess.ChildProcess;
        });
        await expect(new CodexBinaryManager().install()).rejects.toThrow("Node.js was not found");
        expect(mockedExecFile).toHaveBeenCalledTimes(1);
      });

      it("explains how to recover when Windows cannot find npm", async () => {
        setPlatform("win32");
        mockedExecFile.mockImplementation((_command, _args, _options, callback) => {
          (callback as (error: Error | null, stdout: string, stderr: string) => void)(
            new Error("where failed"),
            "",
            ""
          );
          return {} as childProcess.ChildProcess;
        });

        await expect(new CodexBinaryManager().install()).rejects.toThrow(
          "npm was not found. Install Node.js, restart Obsidian, then retry."
        );
      });
    });

    describe("getActionState()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 disables competing actions during path validation and hides unrelated failures", () => {
        const manager = new CodexBinaryManager();
        const state = jest.spyOn(manager, "getRuntimeState");
        for (const kind of ["busy", "detecting"] as const) {
          state.mockReturnValue({ kind });
          expect(manager.getActionState()).toEqual({ kind: "running", label: "Configuring…" });
        }
        state.mockReturnValue({ kind: "error", message: "bad path", operation: "configure" });
        expect(manager.getActionState()).toEqual({ kind: "idle" });
        expect(manager.getActionState()).toBe(manager.getActionState());
        state.mockRestore();
      });
    });

    describe("setCustomBinaryPath()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 normalizes a supported package symlink before selecting the custom adapter", async () => {
        const entry = writeAdapter(path.join(tempDir, "custom"));
        const linked = path.join(tempDir, "codex-acp");
        fs.symlinkSync(entry, linked);
        const manager = new CodexBinaryManager();
        await manager.setCustomBinaryPath(linked);
        expect(getSettings().agentMode.backends?.codex).toMatchObject({
          binaryPath: fs.realpathSync(entry),
          binaryVersion: CODEX_ACP_PINNED_VERSION,
          binarySource: "custom",
        });
      });
      it("rejects an unsupported custom package before changing settings", async () => {
        const entry = writeAdapter(path.join(tempDir, "custom"), "0.0.1");
        const before = getSettings().agentMode.backends?.codex;
        await expect(new CodexBinaryManager().setCustomBinaryPath(entry)).rejects.toThrow();
        expect(getSettings().agentMode.backends?.codex).toEqual(before);
      });
    });
    describe("uninstall()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 preserves legacy custom selections without source metadata", async () => {
        const entry = writeAdapter(path.join(tempDir, "custom"));
        setSettings((current) => ({
          agentMode: {
            ...current.agentMode,
            backends: {
              ...current.agentMode.backends,
              codex: { binaryPath: entry, binaryVersion: CODEX_ACP_PINNED_VERSION },
            },
          },
        }));
        const manager = new CodexBinaryManager();
        fs.mkdirSync(manager.getDataDir(), { recursive: true });
        await manager.uninstall();
        expect(getSettings().agentMode.backends?.codex?.binaryPath).toBe(entry);
        expect(fs.existsSync(entry)).toBe(true);
        expect(fs.existsSync(manager.getDataDir())).toBe(false);
      });
    });
    describe("cancelCurrentOperation()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 cancels after launcher verification without replacing the selected adapter", async () => {
        const manager = new CodexBinaryManager();
        const before = getSettings().agentMode.backends?.codex;
        mockedExecFile.mockImplementation((command, args, _options, callback) => {
          const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
          if (command === "/usr/bin/npm") {
            writeAdapter(args?.[args.indexOf("--prefix") + 1] as string);
            cb(null, "", "");
          } else {
            manager.cancelCurrentOperation();
            cb(null, CODEX_ACP_PINNED_VERSION, "");
          }
          return {} as childProcess.ChildProcess;
        });
        await expect(manager.install()).rejects.toThrow("Aborted");
        expect(getSettings().agentMode.backends?.codex).toEqual(before);
        expect(fs.existsSync(path.join(manager.getDataDir(), CODEX_ACP_PINNED_VERSION))).toBe(
          false
        );
        expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
      });
    });
  });
});
