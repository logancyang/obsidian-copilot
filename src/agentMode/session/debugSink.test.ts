import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FrameLogPaths, FrameRecord, FrameSink, getFrameLogPaths, NodeRuntime } from "./debugSink";

function makeFrame(overrides: Partial<FrameRecord> = {}): FrameRecord {
  return {
    ts: "2026-05-12T00:00:00.000Z",
    dir: "→",
    tag: "codex",
    kind: "notif",
    method: "session/update",
    id: null,
    payload: { ok: true },
    ...overrides,
  };
}

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

interface FakeRuntime extends NodeRuntime {
  files: Map<string, string>;
  directories: Set<string>;
  removedPaths: string[];
}

function makeRuntime(tmpDir = "/tmp", tempRootMode = 0o1755): FakeRuntime {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const removedPaths: string[] = [];
  const mtimes = new Map<string, number>();
  let clock = 0;
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
  return {
    files,
    directories,
    removedPaths,
    tmpdir: () => tmpDir,
    join,
    dirname: (path) => path.slice(0, path.lastIndexOf("/")) || "/",
    mkdir: jest.fn(async (path) => {
      directories.add(path);
    }),
    appendFile: jest.fn(async (path, data) => {
      files.set(path, (files.get(path) ?? "") + data);
      mtimes.set(path, ++clock);
    }),
    writeFile: jest.fn(async (path, data) => {
      files.set(path, data);
      mtimes.set(path, ++clock);
    }),
    rm: jest.fn(async (path) => {
      removedPaths.push(path);
      files.delete(path);
      directories.delete(path);
    }),
    stat: jest.fn(async (path) => {
      const data = files.get(path);
      if (data === undefined) throw errno("ENOENT");
      return { size: Buffer.byteLength(data, "utf8"), mtimeMs: mtimes.get(path) ?? 0 };
    }),
    readdir: jest.fn(async (dir) =>
      [...files.keys()].filter((f) => f.startsWith(dir + "/")).map((f) => f.slice(dir.length + 1))
    ),
    readFile: jest.fn(async (path) => {
      const data = files.get(path);
      if (data === undefined) throw errno("ENOENT");
      return data;
    }),
    chmod: jest.fn(async () => undefined),
    lstat: jest.fn(async (path: string) => {
      if (path === "/") {
        return { uid: 0, mode: 0o755, isDirectory: true, isSymbolicLink: false };
      }
      if (path === tmpDir) {
        return { uid: 1000, mode: tempRootMode, isDirectory: true, isSymbolicLink: false };
      }
      if (files.has(path)) {
        return { uid: 1000, mode: 0o600, isDirectory: false, isSymbolicLink: false };
      }
      if (directories.has(path)) {
        return { uid: 1000, mode: 0o700, isDirectory: true, isSymbolicLink: false };
      }
      throw errno("ENOENT");
    }),
    getuid: () => 1000,
    openPath: jest.fn(async () => ""),
  };
}

function makeRealRuntime(tmpBase: string): NodeRuntime {
  return {
    tmpdir: () => tmpBase,
    join: (...segs: string[]) => path.join(...segs),
    dirname: (p: string) => path.dirname(p),
    mkdir: async (dirPath, opts) => {
      await fs.mkdir(dirPath, opts);
    },
    appendFile: fs.appendFile,
    writeFile: fs.writeFile,
    rm: fs.rm,
    stat: fs.stat,
    readdir: fs.readdir,
    readFile: fs.readFile,
    chmod: fs.chmod,
    lstat: async (p) => {
      const st = await fs.lstat(p);
      return {
        uid: st.uid,
        mode: st.mode,
        isDirectory: st.isDirectory(),
        isSymbolicLink: st.isSymbolicLink(),
      };
    },
    getuid: process.getuid ? () => process.getuid() : undefined,
    openPath: async () => "",
  };
}

const bgPath = (paths: FrameLogPaths): string => `${paths.dirPath}/background.ndjson`;
const sessionPath = (paths: FrameLogPaths, id: string): string =>
  `${paths.dirPath}/session-${id}.ndjson`;
const modeOf = (p: string): number => fsSync.statSync(p).mode & 0o777;
const exists = (p: string): boolean => fsSync.existsSync(p);
const describePosix = process.platform === "win32" ? describe.skip : describe;

describe("debugSink", () => {
  describe("getFrameLogPaths()", () => {
    it("stores frame logs in stable, distinct per-vault temp directories", () => {
      const runtime = makeRuntime("C:/Users/zero/AppData/Local/Temp");
      const first = getFrameLogPaths("C:/Users/zero/Vault", runtime);
      const second = getFrameLogPaths("C:/Users/zero/OtherVault", runtime);

      expect(first.dirPath).toContain("/obsidian-copilot/acp-frames/");
      expect(first.dirPath).not.toBe(second.dirPath);
    });
  });

  describe("FrameSink", () => {
    describe("append()", () => {
      it("summarizes oversized frames before appending", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);

        sink.append(
          makeFrame({
            dir: "←",
            payload: {
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "call-1",
              },
              content: "漢".repeat(30_000),
            },
          })
        );
        await sink.flush();

        const log = runtime.files.get(bgPath(paths)) ?? "";
        expect(log.length).toBeLessThan(5_000);
        expect(log).toContain('"__truncated":true');
        expect(JSON.parse(log).payload.originalBytes).toBeGreaterThan(90_000);
        expect(log).toContain("sessionUpdate=tool_call_update");
        expect(log).toContain("toolCallId=call-1");
      });

      it("keeps only the newest 5 conversations (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);

        for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
          sink.append(makeFrame({ kind: "request", method: "session/prompt", sessionId: id }));
          await sink.flush();
        }

        expect([...runtime.files.keys()].sort()).toEqual(
          ["s2", "s3", "s4", "s5", "s6"].map((id) => sessionPath(paths, id))
        );
      });

      it("cuts an oversized conversation to its first and newest frames and keeps every model and mode (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        const frame = (id: string, payload: unknown) =>
          sink.append(
            makeFrame({
              id,
              sessionId: "chat",
              dir: "←",
              kind: id === "first" ? "result" : "notif",
              method: id === "first" ? "session/new" : "session/update",
              payload,
            })
          );

        frame("first", { sessionId: "chat", models: { currentModelId: "model-a" } });
        for (let i = 0; i < 120; i++) {
          if (i === 60)
            frame("switch", { configOptions: [{ category: "model", currentValue: "model-b" }] });
          frame(`mid-${i}`, { filler: "x".repeat(50_000) });
          if (i % 20 === 19) await sink.flush();
        }
        frame("last", { done: true });
        await sink.flush();

        const text = runtime.files.get(sessionPath(paths, "chat")) ?? "";
        expect(text.length).toBeLessThan(4 * 1024 * 1024);
        expect(text).toContain('"id":"first"');
        expect(text).toContain('"id":"last"');
        expect(text).not.toContain('"id":"mid-30"');
        expect(text).toContain('"frameSink":"elided"');
        expect(text).toContain('"payload":{"model":"model-a"}');
        expect(text).toContain('"payload":{"model":"model-b"}');
      });

      it("caps repeated CJK frames by UTF-8 bytes, including after trimming (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        for (let i = 0; i < 100; i++) {
          sink.append(makeFrame({ sessionId: "cjk", id: String(i), payload: "漢".repeat(20_000) }));
          await sink.flush();
          expect(
            Buffer.byteLength(runtime.files.get(sessionPath(paths, "cjk")) ?? "", "utf8")
          ).toBeLessThanOrEqual(4 * 1024 * 1024);
        }
        const text = runtime.files.get(sessionPath(paths, "cjk")) ?? "";
        expect(text).toContain('"id":"0"');
        expect(text).toContain('"id":"99"');
        expect(text).toContain('"frameSink":"elided"');
      });

      it.each(["queue rejection", "write failure"])(
        "records an identical state after %s rather than caching unwritten evidence (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)",
        async (failure) => {
          const runtime = makeRuntime();
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          const state = makeFrame({
            sessionId: "chat",
            dir: "←",
            payload: { currentModeId: "plan" },
          });
          if (failure === "queue rejection") {
            for (let i = 0; i < 32; i++) sink.append(makeFrame());
          } else {
            (runtime.appendFile as jest.Mock).mockRejectedValueOnce(errno("EIO"));
          }
          sink.append(state);
          await sink.flush();
          sink.append(state);
          await sink.flush();
          const text =
            runtime.files.get(sessionPath(getFrameLogPaths("/vault", runtime), "chat")) ?? "";
          expect(text).toContain('"method":"frameSink.state"');
          expect(text).toContain('"payload":{"mode":"plan"}');
        }
      );

      it("records confirmed mode changes but not a rejected request or unrelated payload (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const emit = (record: Partial<FrameRecord>) =>
          sink.append(makeFrame({ sessionId: "chat", ...record }));
        emit({
          dir: "←",
          kind: "result",
          method: "session/new",
          payload: { modes: { currentModeId: "default" } },
        });
        emit({ kind: "request", method: "session/set_mode", payload: { modeId: "plan" } });
        emit({
          dir: "←",
          kind: "error",
          method: "session/set_mode",
          payload: { message: "rejected" },
        });
        await sink.flush();
        const rejectedText =
          runtime.files.get(sessionPath(getFrameLogPaths("/vault", runtime), "chat")) ?? "";
        expect(rejectedText).not.toContain('"payload":{"mode":"plan"}');
        emit({
          dir: "←",
          payload: { update: { sessionUpdate: "tool_call_update", modeId: "invented" } },
        });
        emit({
          kind: "result",
          method: "session/set_mode",
          payload: {},
          confirmedState: { modeId: "plan" },
        });
        emit({ kind: "request", method: "setSessionMode", payload: { modeId: "plan" } });
        emit({ kind: "result", method: "setSessionMode", payload: { currentModeId: "plan" } });
        emit({
          dir: "←",
          payload: { update: { sessionUpdate: "current_mode_update", currentModeId: "default" } },
        });
        await sink.flush();
        const text =
          runtime.files.get(sessionPath(getFrameLogPaths("/vault", runtime), "chat")) ?? "";
        const states = text
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((record) => record.method === "frameSink.state");
        expect(states.map((record) => record.payload.mode)).toEqual(["default", "plan", "default"]);
      });

      it("keeps the model probe out of the newest 5 conversations (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        sink.markProbeSession("probe");

        for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
          sink.append(makeFrame({ kind: "request", method: "session/prompt", sessionId: id }));
          await sink.flush();
        }
        for (let i = 0; i < 66; i++) {
          sink.append(makeFrame({ method: "session/set_config_option", sessionId: "probe" }));
          await sink.flush();
        }
        sink.append(makeFrame({ kind: "request", method: "session/prompt", sessionId: "c6" }));
        await sink.flush();

        const names = [...runtime.files.keys()].map((f) => f.slice(paths.dirPath.length + 1));
        expect(names.sort()).toEqual([
          "background.ndjson",
          ...["c2", "c3", "c4", "c5", "c6"].map((id) => `session-${id}.ndjson`),
        ]);
      });

      describePosix("temp root validation", () => {
        it.each([
          {
            condition: "a symlink",
            entry: { uid: 1000, mode: 0o1777, isDirectory: true, isSymbolicLink: true },
          },
          {
            condition: "not a directory",
            entry: { uid: 1000, mode: 0o600, isDirectory: false, isSymbolicLink: false },
          },
          {
            condition: "owned by another user",
            entry: { uid: 2000, mode: 0o1777, isDirectory: true, isSymbolicLink: false },
          },
          {
            condition: "group-writable without a sticky bit",
            entry: { uid: 1000, mode: 0o770, isDirectory: true, isSymbolicLink: false },
          },
        ])(
          "writes nothing while the temp root is $condition, then logs once it is safe (https://github.com/logancyang/obsidian-copilot-preview/issues/250)",
          async ({ entry }) => {
            const runtime = makeRuntime();
            const paths = getFrameLogPaths("/vault", runtime);
            const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
            const safeLstat = lstat.getMockImplementation()!;
            lstat.mockImplementation(async (path: string) =>
              path === runtime.tmpdir() ? entry : safeLstat(path)
            );
            const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

            sink.append(makeFrame({ id: "first" }));
            await sink.flush();
            sink.append(makeFrame({ id: "second" }));
            await sink.flush();

            expect(runtime.appendFile).not.toHaveBeenCalled();
            expect(runtime.files.size).toBe(0);

            lstat.mockImplementation(safeLstat);
            sink.append(makeFrame({ id: "third" }));
            await sink.flush();
            expect(runtime.files.get(bgPath(paths))).toContain('"id":"third"');
          }
        );

        it("logs under a root-owned sticky temp root, the shape of a standard Linux /tmp (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRuntime();
          const paths = getFrameLogPaths("/vault", runtime);
          const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
          const safeLstat = lstat.getMockImplementation()!;
          lstat.mockImplementation(async (target: string) =>
            target === runtime.tmpdir()
              ? { uid: 0, mode: 0o1777, isDirectory: true, isSymbolicLink: false }
              : safeLstat(target)
          );
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

          sink.append(makeFrame({ id: "linux-tmp" }));
          await sink.flush();

          expect(runtime.files.get(bgPath(paths))).toContain('"id":"linux-tmp"');
        });
      });

      it("refuses a level that is still not a real directory after creating it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const paths = getFrameLogPaths("/vault", runtime);
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        const safeLstat = lstat.getMockImplementation()!;
        lstat.mockImplementation(async (target: string) =>
          target === paths.dirPath && runtime.directories.has(target)
            ? { uid: 1000, mode: 0o700, isDirectory: false, isSymbolicLink: true }
            : safeLstat(target)
        );
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

        sink.append(makeFrame());
        await sink.flush();

        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.files.size).toBe(0);
      });

      it("drops the frame instead of writing when path validation fails, then recovers (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        lstat.mockRejectedValueOnce(errno("EACCES"));
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);

        sink.append(makeFrame({ id: "first" }));
        await sink.flush();
        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.writeFile).not.toHaveBeenCalled();

        sink.append(makeFrame({ id: "second" }));
        await sink.flush();
        expect(runtime.files.get(bgPath(paths))).toContain('"id":"second"');
      });
    });

    describe("clear()", () => {
      it("clears the conversation and background files", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        runtime.files.set(sessionPath(paths, "a"), "chat");
        runtime.files.set(bgPath(paths), "background");

        await sink.clear();

        expect(runtime.files.size).toBe(0);
      });

      it("re-emits unchanged state when an append is queued immediately after clear (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const state = makeFrame({
          sessionId: "chat",
          dir: "←",
          payload: { currentModelId: "model-a", currentModeId: "default" },
        });
        sink.append(state);
        await sink.flush();
        const cleared = sink.clear();
        sink.append(state);
        await cleared;
        await sink.flush();
        const text =
          runtime.files.get(sessionPath(getFrameLogPaths("/vault", runtime), "chat")) ?? "";
        expect(text).toContain('"method":"frameSink.state"');
        expect(text).toContain('"payload":{"model":"model-a","mode":"default"}');
      });

      it("deletes nothing when path validation fails (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        lstat.mockRejectedValueOnce(errno("EACCES"));
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        runtime.files.set(bgPath(paths), "active");

        await expect(sink.clear()).rejects.toThrow("EACCES");

        expect(runtime.rm).not.toHaveBeenCalled();
        expect(runtime.files.has(bgPath(paths))).toBe(true);
      });
    });

    // Real-filesystem groups: the in-memory runtime cannot prove the owner-only permission
    // boundary. They need a per-test mkdtemp sandbox, umask save/restore and a POSIX-only skip.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/250
    describePosix("on the real filesystem (POSIX)", () => {
      let tmpBase: string;
      let prevUmask: number;

      beforeEach(async () => {
        tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "frame-sink-realfs-"));
        prevUmask = process.umask(0o022);
      });

      afterEach(async () => {
        process.umask(prevUmask);
        await fs.rm(tmpBase, { recursive: true, force: true });
      });

      describe("append()", () => {
        it.each([[0o000], [0o022], [0o077]])(
          "creates the directory chain 0700 and the log file 0600 under umask %o (https://github.com/logancyang/obsidian-copilot-preview/issues/250)",
          async (umask) => {
            process.umask(umask);
            const runtime = makeRealRuntime(tmpBase);
            const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
            const paths = getFrameLogPaths("/vault", runtime);

            sink.append(makeFrame());
            await sink.flush();

            expect(exists(bgPath(paths))).toBe(true);
            expect(modeOf(paths.dirPath)).toBe(0o700);
            expect(modeOf(path.dirname(paths.dirPath))).toBe(0o700);
            expect(modeOf(path.dirname(path.dirname(paths.dirPath)))).toBe(0o700);
            expect(modeOf(bgPath(paths))).toBe(0o600);
          }
        );

        it("narrows a pre-existing permissive directory from an older build (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          process.umask(0o000);
          await fs.mkdir(paths.dirPath, { recursive: true });
          expect(modeOf(paths.dirPath)).toBe(0o777);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(bgPath(paths))).toBe(0o600);
        });

        it("removes a symlink squatting the leaf directory and never writes through it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const victim = path.join(tmpBase, "victim");
          await fs.mkdir(victim, { recursive: true });
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.symlink(victim, paths.dirPath);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(exists(path.join(victim, "background.ndjson"))).toBe(false);
          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isSymbolicLink()).toBe(false);
          expect(leaf.isDirectory()).toBe(true);
          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(bgPath(paths))).toBe(0o600);
        });

        it("refuses a plain file squatting a directory level without deleting it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.writeFile(paths.dirPath, "someone's data", { mode: 0o644 });

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isFile()).toBe(true);
          expect(await fs.readFile(paths.dirPath, "utf8")).toBe("someone's data");
          expect(modeOf(paths.dirPath)).toBe(0o644);
          expect(exists(bgPath(paths))).toBe(false);
        });

        it("removes a dangling symlink squatting the leaf directory path (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.symlink(path.join(tmpBase, "nowhere"), paths.dirPath);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isSymbolicLink()).toBe(false);
          expect(leaf.isDirectory()).toBe(true);
          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(bgPath(paths))).toBe(0o600);
        });

        it("refuses to write into a directory owned by another user instead of falling back (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.dirPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(exists(bgPath(paths))).toBe(false);
        });
      });

      describe("open()", () => {
        it("creates a missing log folder 0700 before opening it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

          await sink.open();

          expect(modeOf(paths.dirPath)).toBe(0o700);
        });
      });

      describe("removeLegacyLogs()", () => {
        it("deletes the single-file logs an older build wrote (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true, mode: 0o700 });
          await fs.writeFile(path.join(paths.dirPath, "acp-frames.ndjson"), "old\n");
          await fs.writeFile(path.join(paths.dirPath, "acp-frames.old.ndjson"), "older\n");

          await new FrameSink({ vaultBasePath: "/vault", runtime }).removeLegacyLogs();

          expect(await fs.readdir(paths.dirPath)).toEqual([]);
        });
      });

      describe("clear()", () => {
        it("does not delete through a symlink squatting the leaf directory (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const victim = path.join(tmpBase, "victim");
          await fs.mkdir(victim, { recursive: true });
          const victimLog = path.join(victim, "background.ndjson");
          await fs.writeFile(victimLog, "victim-data");
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.symlink(victim, paths.dirPath);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          await sink.clear();

          expect(exists(victimLog)).toBe(true);
        });
      });
    });
  });
});
