import { installCodexArchive, CODEX_BUNDLE_VERSION } from "./codexArchive";
jest.mock("./codexArchive", () => ({
  installCodexArchive: jest.fn(),
  CODEX_BUNDLE_VERSION: "1.10.0-r1",
}));
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
      mockedExecFile.mockReset().mockImplementation((_command, _args, _options, callback) => {
        (callback as (error: Error | null, stdout: string, stderr: string) => void)(
          null,
          `${CODEX_ACP_PINNED_VERSION} Codex CLI`,
          ""
        );
        return {} as childProcess.ChildProcess;
      });
      jest
        .mocked(installCodexArchive)
        .mockReset()
        .mockImplementation(async (stage) => {
          fs.writeFileSync(path.join(stage, "codex-acp"), "native");
          fs.writeFileSync(
            path.join(stage, "provenance.json"),
            JSON.stringify({
              acpVersion: CODEX_ACP_PINNED_VERSION,
              packagingRevision: 1,
              target: `darwin-${process.arch}`,
            })
          );
        });
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
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 selects the verified native bundle without invoking npm", async () => {
        const manager = new CodexBinaryManager();
        const listener = jest.fn();
        const unsubscribe = manager.subscribeRuntimeState(listener);
        await manager.install();
        expect(getSettings().agentMode.backends?.codex).toMatchObject({
          binarySource: "managed",
          binaryVersion: CODEX_BUNDLE_VERSION,
          binaryPath: path.join(manager.getDataDir(), CODEX_BUNDLE_VERSION, "codex-acp"),
        });
        expect(mockedDetectBinary).not.toHaveBeenCalled();
        expect(listener).toHaveBeenCalled();
        expect(manager.getActionState()).toEqual({ kind: "idle" });
        unsubscribe();
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects a wrong adapter version or missing bundled runtime before selecting files", async () => {
        const manager = new CodexBinaryManager();
        const before = getSettings().agentMode.backends?.codex;
        for (const output of ["0.0.1", CODEX_ACP_PINNED_VERSION]) {
          mockedExecFile.mockImplementation((_command, _args, _options, callback) => {
            (callback as (error: Error | null, stdout: string, stderr: string) => void)(
              null,
              output,
              ""
            );
            return {} as childProcess.ChildProcess;
          });
          await expect(manager.install()).rejects.toThrow(
            output === "0.0.1" ? "did not report version" : "runtime could not start"
          );
          expect(getSettings().agentMode.backends?.codex).toEqual(before);
          expect(fs.readdirSync(manager.getDataDir())).toEqual([]);
        }
      });
      it.each(["download", "launcher"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves the selected native installation after a %s failure",
        async (failure) => {
          const manager = new CodexBinaryManager();
          const previousDir = path.join(manager.getDataDir(), "1.9.0-r1");
          fs.mkdirSync(previousDir, { recursive: true });
          const entry = path.join(previousDir, "codex-acp");
          fs.writeFileSync(entry, "native");
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: {
                ...cur.agentMode.backends,
                codex: { binarySource: "managed", binaryPath: entry, binaryVersion: "1.9.0-r1" },
              },
            },
          }));
          if (failure === "download")
            jest.mocked(installCodexArchive).mockRejectedValue(new Error("download failed"));
          else
            mockedExecFile.mockImplementation((_c, _a, _o, cb) => {
              (cb as (error: Error | null, stdout: string, stderr: string) => void)(
                new Error("launcher failed"),
                "",
                ""
              );
              return {} as childProcess.ChildProcess;
            });
          await expect(manager.install()).rejects.toThrow(`${failure} failed`);
          expect(getSettings().agentMode.backends?.codex?.binaryPath).toBe(entry);
          expect(fs.existsSync(entry)).toBe(true);
          expect(fs.readdirSync(manager.getDataDir())).toEqual(["1.9.0-r1"]);
        }
      );
    });

    describe("getDataDir()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects a missing home before choosing an installation directory", () => {
        mockedHomedir.mockReturnValue("");
        expect(() => new CodexBinaryManager().getDataDir()).toThrow("home directory");
      });
    });
    describe("getActionState()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 exposes installation progress and retryable failures", () => {
        const manager = new CodexBinaryManager();
        const state = jest.spyOn(manager, "getRuntimeState");
        state.mockReturnValue({
          kind: "installing",
          progress: { label: "Downloading", percent: 30 },
        });
        expect(manager.getActionState()).toEqual({
          kind: "running",
          label: "Downloading",
          percent: 30,
        });
        state.mockReturnValue({ kind: "error", message: "download failed", operation: "install" });
        expect(manager.getActionState()).toEqual({ kind: "error", message: "download failed" });
        state.mockRestore();
      });
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
          manager.cancelCurrentOperation();
          cb(null, `${CODEX_ACP_PINNED_VERSION} Codex CLI`, "");
          return {} as childProcess.ChildProcess;
        });
        await expect(manager.install()).rejects.toThrow("Aborted");
        expect(getSettings().agentMode.backends?.codex).toEqual(before);
        expect(fs.existsSync(path.join(manager.getDataDir(), CODEX_BUNDLE_VERSION))).toBe(false);
        expect(manager.getRuntimeState()).toEqual({ kind: "idle" });
      });
    });
  });
});
