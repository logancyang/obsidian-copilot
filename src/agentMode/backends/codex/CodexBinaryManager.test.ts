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
const PREVIOUS_DIR = "1.9.0-r1-12345678-1234-4123-8123-123456789abc";

function writeNativeBundle(root: string): string {
  fs.mkdirSync(root, { recursive: true });
  const entry = path.join(root, "codex-acp");
  fs.writeFileSync(entry, "native");
  return entry;
}

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
    let originalCodexHome: string | undefined;

    beforeEach(() => {
      originalCodexHome = process.env.CODEX_HOME;
      delete process.env.CODEX_HOME;
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
      mockedDetectBinary.mockReset().mockResolvedValue(null);
      originalAgentMode = getSettings().agentMode;
      setPlatform("darwin");
    });

    afterEach(() => {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      setSettings({ agentMode: originalAgentMode });
      setPlatform(originalPlatform);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe("install()", () => {
      it.each(["managed", "custom", "legacy", "absent"] as const)(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 explicitly upgrades %s settings without changing profiles or deleting previous software after restart",
        async (source) => {
          const manager = new CodexBinaryManager();
          const previous =
            source === "managed"
              ? writeNativeBundle(path.join(manager.getDataDir(), PREVIOUS_DIR))
              : writeAdapter(path.join(tempDir, "custom"));
          const profile = path.join(tempDir, "my profile");
          fs.mkdirSync(profile);
          fs.writeFileSync(path.join(profile, "auth.json"), "fixture-file-auth");
          fs.writeFileSync(
            path.join(profile, "config.toml"),
            'cli_auth_credentials_store = "keyring"'
          );
          const envOverrides = {
            CODEX_HOME: profile,
            CODEX_CONFIG: '{"cli_auth_credentials_store":"keyring"}',
          };
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: {
                ...cur.agentMode.backends,
                codex: {
                  ...(source !== "absent"
                    ? {
                        binaryPath: previous,
                        binaryVersion: source === "managed" ? "1.9.0-r1" : "1.10.0",
                      }
                    : {}),
                  ...(source === "managed" || source === "custom" ? { binarySource: source } : {}),
                  envOverrides,
                },
              },
            },
          }));
          const stage = path.join(manager.getDataDir(), `.tmp-${PREVIOUS_DIR}`);
          fs.mkdirSync(stage, { recursive: true });
          fs.writeFileSync(path.join(stage, "partial"), "interrupted download");
          const installed = await manager.install();
          expect(installed.version).toBe(CODEX_BUNDLE_VERSION);
          expect(fs.existsSync(installed.path)).toBe(true);
          expect(getSettings().agentMode.backends?.codex?.envOverrides).toEqual(envOverrides);
          expect(fs.readFileSync(path.join(profile, "auth.json"), "utf8")).toBe(
            "fixture-file-auth"
          );
          expect(fs.readFileSync(path.join(profile, "config.toml"), "utf8")).toContain('"keyring"');
          const persisted = JSON.parse(JSON.stringify(getSettings().agentMode));
          setSettings({ agentMode: persisted });
          expect(new CodexBinaryManager().getActionState()).toEqual({ kind: "idle" });
          // Another vault can still use the previous directory, even after this vault restarts.
          expect(fs.existsSync(previous)).toBe(true);
          expect(fs.existsSync(stage)).toBe(true);
        }
      );
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 preserves an active old revision and installs the same revision into a fresh directory", async () => {
        const manager = new CodexBinaryManager();
        const first = await manager.install();
        const release = manager.reserveBinary(first.path);
        const second = await manager.install();
        expect(second.path).not.toBe(first.path);
        expect(fs.readFileSync(first.path, "utf8")).toBe("native");
        expect(fs.existsSync(second.path)).toBe(true);
        await expect(manager.uninstall()).rejects.toThrow("Close Codex sessions");
        release();
        await manager.uninstall();
        expect(fs.existsSync(first.path)).toBe(false);
        expect(fs.existsSync(second.path)).toBe(false);
      });
      it.each(["extraction", "runtime", "cancel"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 retains the previous native selection through %s failure and succeeds on retry",
        async (fault) => {
          const manager = new CodexBinaryManager();
          const previous = writeNativeBundle(path.join(manager.getDataDir(), PREVIOUS_DIR));
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: {
                ...cur.agentMode.backends,
                codex: { binaryPath: previous, binarySource: "managed", binaryVersion: "1.9.0-r1" },
              },
            },
          }));
          const before = getSettings().agentMode.backends?.codex;
          if (fault === "extraction")
            jest.mocked(installCodexArchive).mockImplementationOnce(async (stage) => {
              fs.writeFileSync(path.join(stage, "partial"), "partial archive");
              throw new Error("extraction failed");
            });
          if (fault === "cancel")
            jest
              .mocked(installCodexArchive)
              .mockImplementationOnce(async () => manager.cancelCurrentOperation());
          if (fault === "runtime")
            mockedExecFile
              .mockImplementationOnce((_c, _a, _o, cb) => {
                (cb as (error: Error | null, stdout: string, stderr: string) => void)(
                  null,
                  CODEX_ACP_PINNED_VERSION,
                  ""
                );
                return {} as childProcess.ChildProcess;
              })
              .mockImplementationOnce((_c, _a, _o, cb) => {
                (cb as (error: Error | null, stdout: string, stderr: string) => void)(
                  null,
                  "broken runtime",
                  ""
                );
                return {} as childProcess.ChildProcess;
              });
          await expect(manager.install()).rejects.toThrow();
          expect(getSettings().agentMode.backends?.codex).toEqual(before);
          expect(fs.readdirSync(manager.getDataDir())).toEqual([PREVIOUS_DIR]);
          await manager.install();
          expect(fs.existsSync(previous)).toBe(true);
          expect(getSettings().agentMode.backends?.codex?.binaryPath).not.toBe(previous);
        }
      );

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 selects the verified native bundle without invoking npm", async () => {
        const manager = new CodexBinaryManager();
        const listener = jest.fn();
        const unsubscribe = manager.subscribeRuntimeState(listener);
        await manager.install();
        expect(getSettings().agentMode.backends?.codex).toMatchObject({
          binarySource: "managed",
          binaryVersion: CODEX_BUNDLE_VERSION,
          binaryPath: expect.stringContaining(
            path.join(manager.getDataDir(), `${CODEX_BUNDLE_VERSION}-`)
          ),
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
          const previousDir = path.join(manager.getDataDir(), PREVIOUS_DIR);
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
          expect(fs.readdirSync(manager.getDataDir())).toEqual([PREVIOUS_DIR]);
        }
      );
    });

    describe("getDataDir()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 rejects a missing home before choosing an installation directory", () => {
        mockedHomedir.mockReturnValue("");
        expect(() => new CodexBinaryManager().getDataDir()).toThrow("home directory");
      });
    });
    describe("reserveBinary()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 counts overlapping users and tolerates repeated release", async () => {
        const manager = new CodexBinaryManager();
        const installed = await manager.install();
        const releaseA = manager.reserveBinary(installed.path);
        const releaseB = manager.reserveBinary(installed.path);
        releaseA();
        releaseA();
        await expect(manager.uninstall()).rejects.toThrow("Close Codex sessions");
        releaseB();
        await manager.uninstall();
        expect(fs.existsSync(installed.path)).toBe(false);
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 refuses a new launch during an install", async () => {
        const manager = new CodexBinaryManager();
        await manager.install({
          onProgress: () =>
            expect(() => manager.reserveBinary("/custom/codex-acp")).toThrow(
              "Wait for Codex setup"
            ),
        });
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
      it.each(["custom", "profile"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 preserves a selected %s symlink inside a managed version that points outside storage",
        async (selection) => {
          const manager = new CodexBinaryManager();
          const external = path.join(tempDir, "external");
          fs.mkdirSync(external);
          fs.writeFileSync(path.join(external, "fixture"), "user-owned");
          const owned = path.join(manager.getDataDir(), PREVIOUS_DIR);
          fs.mkdirSync(owned, { recursive: true });
          const link = path.join(owned, "selected");
          fs.symlinkSync(selection === "custom" ? path.join(external, "fixture") : external, link);
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: {
                ...cur.agentMode.backends,
                codex:
                  selection === "custom"
                    ? { binaryPath: link, binarySource: "custom" }
                    : { envOverrides: { CODEX_HOME: link } },
              },
            },
          }));
          const before = getSettings().agentMode.backends?.codex;
          await manager.uninstall();
          expect(
            fs.readFileSync(selection === "custom" ? link : path.join(link, "fixture"), "utf8")
          ).toBe("user-owned");
          expect(getSettings().agentMode.backends?.codex).toMatchObject(before!);
        }
      );
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 removes only native UUID versions and stages while preserving unrecognized folders", async () => {
        const manager = new CodexBinaryManager();
        const preserved = [
          "1.10.0",
          "1.10.0-r1",
          ".tmp-1.10.0-12345",
          `${PREVIOUS_DIR}.old-abcd`,
          "user-files",
        ];
        const removed = [PREVIOUS_DIR, `.tmp-${PREVIOUS_DIR}`];
        for (const name of [...preserved, ...removed])
          writeNativeBundle(path.join(manager.getDataDir(), name));
        await manager.uninstall();
        expect(fs.readdirSync(manager.getDataDir()).sort()).toEqual(preserved.sort());
      });
      it.each(["default", "override"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 preserves a %s profile symlink into a managed version",
        async (mode) => {
          const manager = new CodexBinaryManager();
          const profile = path.join(manager.getDataDir(), PREVIOUS_DIR, "profile");
          fs.mkdirSync(profile, { recursive: true });
          fs.writeFileSync(path.join(profile, "auth.json"), "fixture-auth");
          const link = path.join(tempDir, mode === "default" ? ".codex" : "profile-link");
          fs.symlinkSync(profile, link);
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: {
                ...cur.agentMode.backends,
                codex: { envOverrides: mode === "override" ? { CODEX_HOME: link } : undefined },
              },
            },
          }));
          await manager.uninstall();
          expect(fs.readFileSync(path.join(link, "auth.json"), "utf8")).toBe("fixture-auth");
        }
      );

      it.each(["default", "override"])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/380 removes only owned versions while retaining the %s profile and global installation",
        async (mode) => {
          const manager = new CodexBinaryManager();
          const global = writeAdapter(path.join(tempDir, "global"));
          const profile =
            mode === "override"
              ? path.join(manager.getDataDir(), PREVIOUS_DIR, "profile")
              : path.join(tempDir, ".codex");
          fs.mkdirSync(profile, { recursive: true });
          fs.writeFileSync(path.join(profile, "auth.json"), "fixture-auth");
          fs.mkdirSync(path.join(manager.getDataDir(), "unknown-user-folder"), { recursive: true });
          const old = writeNativeBundle(
            path.join(manager.getDataDir(), "1.10.0-r1-12345678-1234-4123-8123-123456789abc")
          );
          setSettings((cur) => ({
            agentMode: {
              ...cur.agentMode,
              backends: {
                ...cur.agentMode.backends,
                codex: {
                  binaryPath: old,
                  binarySource: "managed",
                  envOverrides: mode === "override" ? { CODEX_HOME: profile } : undefined,
                },
              },
            },
          }));
          await manager.install();
          await manager.uninstall();
          expect(fs.existsSync(old)).toBe(false);
          expect(fs.existsSync(global)).toBe(true);
          expect(fs.readFileSync(path.join(profile, "auth.json"), "utf8")).toBe("fixture-auth");
          expect(fs.existsSync(path.join(manager.getDataDir(), "unknown-user-folder"))).toBe(true);
          expect(getSettings().agentMode.backends?.codex?.binaryPath).toBeUndefined();
        }
      );
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/380 preserves a legacy custom selection within managed storage", async () => {
        const manager = new CodexBinaryManager();
        const custom = writeAdapter(path.join(manager.getDataDir(), PREVIOUS_DIR));
        setSettings((cur) => ({
          agentMode: {
            ...cur.agentMode,
            backends: { ...cur.agentMode.backends, codex: { binaryPath: custom } },
          },
        }));
        await manager.uninstall();
        expect(fs.existsSync(custom)).toBe(true);
        expect(getSettings().agentMode.backends?.codex?.binaryPath).toBe(custom);
      });

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
        expect(fs.readdirSync(manager.getDataDir())).toEqual([]);
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
