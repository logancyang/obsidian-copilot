import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FrameRecord, FrameSink, getFrameLogPaths, NodeRuntime } from "./debugSink";

function bgPath(runtime: NodeRuntime, vault = "/vault"): string {
  return runtime.join(getFrameLogPaths(vault, runtime).dirPath, "background.ndjson");
}

function sessionPath(runtime: NodeRuntime, sessionId: string, vault = "/vault"): string {
  return runtime.join(getFrameLogPaths(vault, runtime).dirPath, `session-${sessionId}.ndjson`);
}

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
  mtimes: Map<string, number>;
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
    mtimes,
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
    readdir: jest.fn(async (path) =>
      [...files.keys()]
        .filter((file) => file.startsWith(`${path}/`))
        .map((file) => file.slice(path.length + 1))
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
    stat: async (p) => {
      const stat = await fs.stat(p);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    },
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

const modeOf = (p: string): number => fsSync.statSync(p).mode & 0o777;
const exists = (p: string): boolean => fsSync.existsSync(p);
const describePosix = process.platform === "win32" ? describe.skip : describe;

describe("debugSink", () => {
  describe("getFrameLogPaths()", () => {
    it("stores frame logs in stable, distinct per-vault temp directories", () => {
      const runtime = makeRuntime("C:/Users/zero/AppData/Local/Temp");
      const first = getFrameLogPaths("C:/Users/zero/Vault", runtime);
      const second = getFrameLogPaths("C:/Users/zero/OtherVault", runtime);

      expect(first.logPath).toContain("/obsidian-copilot/acp-frames/");
      expect(first.logPath).toMatch(/\/acp-frames\.ndjson$/);
      expect(first.rotatedPath).toMatch(/\/acp-frames\.old\.ndjson$/);
      expect(first.dirPath).not.toBe(second.dirPath);
    });
  });

  describe("FrameSink", () => {
    describe("append()", () => {
      it("retains five recently active prompted sessions and matching startup prelude across restart (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        for (let index = 0; index < 5; index++) {
          sink.append(
            makeFrame({
              sessionId: `chat-${index}`,
              method: "session/prompt",
              kind: "request",
              startsConversation: true,
              payload: index === 1 ? { oldOpening: true } : { ok: true },
            })
          );
          await sink.flush();
        }
        sink.append(makeFrame({ sessionId: "chat-0", method: "session/update" }));
        await sink.flush();
        sink.append(
          makeFrame({
            sessionId: "chat-5",
            method: "session/new",
            kind: "result",
            payload: { model: "startup" },
          })
        );
        sink.append(
          makeFrame({ sessionId: null, method: "initialize", payload: { startup: true } })
        );
        sink.append(
          makeFrame({
            sessionId: "chat-5",
            tag: "other",
            method: "session/set_model",
            payload: { model: "wrong-tag" },
          })
        );
        sink.append(
          makeFrame({
            sessionId: "chat-5",
            tag: "codex",
            method: "session/set_model",
            payload: { model: "selected" },
          })
        );
        sink.append(
          makeFrame({
            sessionId: "chat-5",
            method: "session/prompt",
            kind: "request",
            startsConversation: true,
            payload: { prompt: [] },
          })
        );
        await sink.flush();
        const snapshot = await new FrameSink({
          vaultBasePath: "/vault",
          runtime,
        }).readConversations();
        expect(snapshot).toContain('"file":"session-chat-0.ndjson"');
        expect(snapshot).toContain('"file":"session-chat-5.ndjson"');
        expect(snapshot).not.toContain('"file":"session-chat-1.ndjson"');
        expect(snapshot).toContain('{"model":"selected"}');
        const chatFive = snapshot
          ?.split('{"frameSink":"conversation","file":"session-chat-5.ndjson"}\n')[1]
          .split('{"frameSink":"conversation"')[0];
        expect(chatFive).not.toContain("wrong-tag");
        expect(snapshot).toContain("wrong-tag");
        expect(snapshot).toContain('{"startup":true}');
        expect(runtime.files.has(sessionPath(runtime, "chat-1"))).toBe(false);
        expect(runtime.files.has(bgPath(runtime))).toBe(true);
        sink.append(
          makeFrame({ sessionId: "chat-1", method: "session/update", payload: { returned: true } })
        );
        await sink.flush();
        expect(runtime.files.has(sessionPath(runtime, "chat-1"))).toBe(false);
        sink.append(
          makeFrame({
            sessionId: "chat-1",
            method: "session/prompt",
            kind: "request",
            startsConversation: true,
          })
        );
        await sink.flush();
        expect(runtime.files.get(sessionPath(runtime, "chat-1"))).not.toContain("oldOpening");
        expect(runtime.files.get(sessionPath(runtime, "chat-1"))).toContain('"returned":true');
      });

      it("does not let a prompt dropped at the queue cap create a session slot (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        const write = runtime.appendFile;
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        runtime.appendFile = async (...args) => {
          entered();
          await held;
          await write(...args);
        };
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        sink.append(makeFrame({ id: "held" }));
        await started;
        for (let index = 0; index < 31; index++) sink.append(makeFrame({ id: `queued-${index}` }));
        sink.append(
          makeFrame({
            sessionId: "dropped",
            method: "session/prompt",
            kind: "request",
            startsConversation: true,
          })
        );
        release();
        await sink.flush();
        sink.append(makeFrame({ id: "after-drop" }));
        await sink.flush();
        expect(runtime.files.has(sessionPath(runtime, "dropped"))).toBe(false);
        expect(runtime.files.get(bgPath(runtime))).toContain('"method":"frameSink.dropped"');
      });

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
              content: "x".repeat(100_000),
            },
          })
        );
        await sink.flush();

        const log = runtime.files.get(runtime.join(paths.dirPath, "background.ndjson")) ?? "";
        expect(log.length).toBeLessThan(5_000);
        expect(log).toContain('"__truncated":true');
        expect(log).toContain("sessionUpdate=tool_call_update");
        expect(log).toContain("toolCallId=call-1");
      });

      it.each(["background", "session"] as const)(
        "compacts an oversized %s file to the retained byte limit (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)",
        async (kind) => {
          const runtime = makeRuntime();
          const file = kind === "background" ? bgPath(runtime) : sessionPath(runtime, "bounded");
          runtime.files.set(file, "x".repeat(4 * 1024 * 1024 + 1));
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame(kind === "session" ? { sessionId: "bounded" } : {}));
          await sink.flush();
          expect(Buffer.byteLength(runtime.files.get(file)!, "utf8")).toBeLessThanOrEqual(
            3 * 1024 * 1024
          );
        }
      );

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
            expect(runtime.files.get(runtime.join(paths.dirPath, "background.ndjson"))).toContain(
              '"id":"third"'
            );
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

          expect(runtime.files.get(runtime.join(paths.dirPath, "background.ndjson"))).toContain(
            '"id":"linux-tmp"'
          );
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

      it("refuses to write when a directory occupies the log file path (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const paths = getFrameLogPaths("/vault", runtime);
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        const safeLstat = lstat.getMockImplementation()!;
        lstat.mockImplementation(async (target: string) =>
          target === paths.logPath
            ? { uid: 1000, mode: 0o700, isDirectory: true, isSymbolicLink: false }
            : safeLstat(target)
        );
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

        sink.append(makeFrame());
        await sink.flush();

        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.rm).not.toHaveBeenCalled();
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
        expect(runtime.files.get(runtime.join(paths.dirPath, "background.ndjson"))).toContain(
          '"id":"second"'
        );
      });
    });

    describe("readConversations()", () => {
      it("returns null when no conversation or background evidence exists", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ runtime, vaultBasePath: "/vault" });

        await expect(sink.readConversations()).resolves.toBeNull();
      });

      it("returns null when there is no vault to key the location off (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ runtime });

        await expect(sink.readConversations()).resolves.toBeNull();
      });

      it("returns null rather than throwing when the temp root cannot be trusted (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: "linux" });
        try {
          const runtime = makeRuntime("/tmp", 0o0777);
          const sink = new FrameSink({ runtime, vaultBasePath: "/vault" });

          await expect(sink.readConversations()).resolves.toBeNull();
        } finally {
          Object.defineProperty(process, "platform", platform);
        }
      });

      it("snapshots earlier queued writes but excludes later appends until the next read (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
        const runtime = makeRuntime();
        let enterWrite!: () => void;
        let releaseWrite!: () => void;
        const entered = new Promise<void>((resolve) => {
          enterWrite = resolve;
        });
        const held = new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        const queuedWrite = runtime.appendFile;
        runtime.appendFile = async (target, data, opts) => {
          enterWrite();
          await held;
          await queuedWrite(target, data, opts);
        };
        const sink = new FrameSink({ runtime, vaultBasePath: "/vault" });
        sink.append(makeFrame({ id: "before" }));
        await entered;
        const snapshot = sink.readConversations();
        sink.append(makeFrame({ id: "after" }));
        releaseWrite();
        const text = await snapshot;
        expect(text).toContain('"id":"before"');
        expect(text).not.toContain('"id":"after"');
        await sink.flush();
        await expect(sink.readConversations()).resolves.toContain('"id":"after"');
      });

      it("leaves the sink usable after refusing a location, so a later flush still settles", async () => {
        const runtime = makeRuntime("/tmp", 0o0777);
        const sink = new FrameSink({ runtime, vaultBasePath: "/vault" });

        await sink.readConversations();

        await expect(sink.flush()).resolves.toBeUndefined();
      });
    });

    describe("clear()", () => {
      it("clears active and rotated log files", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        runtime.files.set(paths.logPath, "active");
        runtime.files.set(paths.rotatedPath, "old");
        runtime.files.set(bgPath(runtime), "background");
        runtime.files.set(sessionPath(runtime, "chat"), "session");
        const unrelated = runtime.join(paths.dirPath, "notes.txt");
        runtime.files.set(unrelated, "keep");
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const appendFile = runtime.appendFile;
        runtime.appendFile = async (...args) => {
          entered();
          await held;
          await appendFile(...args);
        };
        sink.append(makeFrame({ sessionId: "chat", id: "before-clear" }));
        await started;
        const clearing = sink.clear();
        sink.append(makeFrame({ sessionId: "chat", id: "after-clear" }));
        release();
        await clearing;
        await sink.flush();

        expect(runtime.files.has(paths.logPath)).toBe(false);
        expect(runtime.files.has(paths.rotatedPath)).toBe(false);
        expect(runtime.files.get(bgPath(runtime))).toContain('"id":"after-clear"');
        expect(runtime.files.has(sessionPath(runtime, "chat"))).toBe(false);
        expect(runtime.files.get(unrelated)).toBe("keep");
        sink.append(
          makeFrame({
            sessionId: "chat",
            method: "session/prompt",
            kind: "request",
            startsConversation: true,
          })
        );
        await sink.flush();
        expect(runtime.files.get(sessionPath(runtime, "chat"))).toContain('"id":"after-clear"');
        expect(runtime.files.get(sessionPath(runtime, "chat"))).not.toContain("before-clear");
        expect(runtime.removedPaths).toEqual(
          expect.arrayContaining([paths.logPath, paths.rotatedPath])
        );
      });

      it("deletes nothing when path validation fails (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        lstat.mockRejectedValueOnce(errno("EACCES"));
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        runtime.files.set(paths.logPath, "active");

        await expect(sink.clear()).rejects.toThrow("EACCES");

        expect(runtime.rm).not.toHaveBeenCalled();
        expect(runtime.files.has(paths.logPath)).toBe(true);
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

            expect(exists(path.join(paths.dirPath, "background.ndjson"))).toBe(true);
            expect(modeOf(paths.dirPath)).toBe(0o700);
            expect(modeOf(path.dirname(paths.dirPath))).toBe(0o700);
            expect(modeOf(path.dirname(path.dirname(paths.dirPath)))).toBe(0o700);
            expect(modeOf(path.join(paths.dirPath, "background.ndjson"))).toBe(0o600);
          }
        );

        it("narrows a pre-existing permissive directory and both log generations from an older build (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          process.umask(0o000);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "old-active\n", { mode: 0o644 });
          await fs.writeFile(paths.rotatedPath, "old-rotated\n", { mode: 0o644 });
          expect(modeOf(paths.dirPath)).toBe(0o777);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(path.join(paths.dirPath, "background.ndjson"))).toBe(0o600);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
          const content = await fs.readFile(paths.logPath, "utf8");
          expect(content).toBe("old-active\n");
          expect(await fs.readFile(paths.rotatedPath, "utf8")).toBe("old-rotated\n");
          expect(
            await fs.readFile(path.join(paths.dirPath, "background.ndjson"), "utf8")
          ).toContain('"session/update"');
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

          expect(exists(path.join(victim, "acp-frames.ndjson"))).toBe(false);
          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isSymbolicLink()).toBe(false);
          expect(leaf.isDirectory()).toBe(true);
          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(path.join(paths.dirPath, "background.ndjson"))).toBe(0o600);
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
          expect(exists(paths.logPath)).toBe(false);
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
          expect(modeOf(path.join(paths.dirPath, "background.ndjson"))).toBe(0o600);
        });

        it("removes a symlink squatting the log file itself and leaves its target untouched (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const victimFile = path.join(tmpBase, "victim.txt");
          const managedPath = path.join(paths.dirPath, "background.ndjson");
          await fs.writeFile(victimFile, "victim-content", { mode: 0o644 });
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.symlink(victimFile, managedPath);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(await fs.readFile(victimFile, "utf8")).toBe("victim-content");
          expect(modeOf(victimFile)).toBe(0o644);
          const log = await fs.lstat(managedPath);
          expect(log.isSymbolicLink()).toBe(false);
          expect(modeOf(managedPath)).toBe(0o600);
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

          expect(exists(path.join(paths.dirPath, "background.ndjson"))).toBe(false);
        });

        it("leaves a log file owned by another user unread and unnarrowed (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "someone else's frames\n", { mode: 0o644 });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.dirPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(await fs.readFile(paths.logPath, "utf8")).toBe("someone else's frames\n");
          expect(modeOf(paths.logPath)).toBe(0o644);
        });

        it("keeps legacy logs unchanged while managed files remain private (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "legacy-current", { mode: 0o644 });
          await fs.writeFile(paths.rotatedPath, "legacy-old", { mode: 0o644 });
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame({ id: "managed" }));
          await sink.flush();
          expect(await fs.readFile(paths.logPath, "utf8")).toBe("legacy-current");
          expect(await fs.readFile(paths.rotatedPath, "utf8")).toBe("legacy-old");
          expect(modeOf(path.join(paths.dirPath, "background.ndjson"))).toBe(0o600);
        });
      });

      describe("readConversations()", () => {
        it("selects equal-mtime sessions by ascending filename (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
          const runtime = makeRuntime();
          const paths = getFrameLogPaths("/vault", runtime);
          for (let index = 0; index < 6; index++) {
            const name = `session-chat-${index}.ndjson`;
            runtime.files.set(
              runtime.join(paths.dirPath, name),
              JSON.stringify(makeFrame({ sessionId: `chat-${index}` })) + "\\n"
            );
            runtime.mtimes.set(runtime.join(paths.dirPath, name), 5);
          }
          const snapshot = await new FrameSink({
            vaultBasePath: "/vault",
            runtime,
          }).readConversations();
          expect(snapshot).toContain('"file":"session-chat-0.ndjson"');
          expect(snapshot).not.toContain('"file":"session-chat-5.ndjson"');
        });

        it("includes useful background-only evidence without requiring a prompted session", async () => {
          const runtime = makeRuntime();
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame({ sessionId: null, method: "initialize" }));
          await sink.flush();
          await expect(sink.readConversations()).resolves.toContain('"file":"background.ndjson"');
        });

        it("uses the current legacy log before any new conversation and leaves rotated content out (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
          const runtime = makeRuntime();
          const paths = getFrameLogPaths("/vault", runtime);
          runtime.files.set(paths.logPath, "legacy-current\\n");
          runtime.files.set(paths.rotatedPath, "legacy-old\\n");
          const text = await new FrameSink({
            vaultBasePath: "/vault",
            runtime,
          }).readConversations();
          expect(text).toContain('"file":"acp-frames.ndjson"');
          expect(text).toContain("legacy-current");
          expect(text).not.toContain("legacy-old");
        });

        it("omits an oversized legacy log without reading its contents (https://github.com/Brevilabs/obsidian-copilot-private/issues/658)", async () => {
          const runtime = makeRuntime();
          const paths = getFrameLogPaths("/vault", runtime);
          runtime.files.set(paths.logPath, "small fake legacy");
          const stat = runtime.stat as jest.MockedFunction<NodeRuntime["stat"]>;
          const originalStat = stat.getMockImplementation()!;
          stat.mockImplementation(async (target) =>
            target === paths.logPath
              ? { size: 64 * 1024 * 1024 + 1, mtimeMs: 1 }
              : originalStat(target)
          );
          const snapshot = await new FrameSink({
            vaultBasePath: "/vault",
            runtime,
          }).readConversations();
          expect(snapshot).toContain("legacy log exceeds the report read limit");
          expect(runtime.readFile).not.toHaveBeenCalledWith(paths.logPath, "utf8");
        });

        it("unlinks a same-name symlink planted at the log path instead of vouching for its target (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const decoyDir = path.join(tmpBase, "decoy");
          await fs.mkdir(decoyDir, { recursive: true });
          const decoy = path.join(decoyDir, path.basename(paths.logPath));
          await fs.writeFile(decoy, "planted\n");
          await fs.mkdir(paths.dirPath, { recursive: true, mode: 0o700 });
          await fs.symlink(decoy, paths.logPath);

          const resolved = await new FrameSink({
            vaultBasePath: "/vault",
            runtime,
          }).readConversations();

          expect(resolved).toBeNull();
          expect(fsSync.lstatSync(decoy).isFile()).toBe(true);
          expect(await fs.readFile(decoy, "utf8")).toBe("planted\n");
          expect(exists(paths.logPath)).toBe(false);
        });

        it("refuses a log file another account owns (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true, mode: 0o700 });
          await fs.writeFile(paths.logPath, "someone else's\n", { mode: 0o600 });
          const foreign: NodeRuntime = {
            ...runtime,
            lstat: async (p) =>
              p === paths.logPath
                ? { uid: 4242, mode: 0o600, isDirectory: false, isSymbolicLink: false }
                : runtime.lstat(p),
          };

          const resolved = await new FrameSink({
            vaultBasePath: "/vault",
            runtime: foreign,
          }).readConversations();

          expect(resolved).toBeNull();
        });
      });

      describe("open()", () => {
        it("creates a missing log file 0600 before opening it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

          await sink.open();

          expect(sink.getPath()).toBe(paths.dirPath);
          expect(exists(paths.logPath)).toBe(false);
          expect(exists(paths.rotatedPath)).toBe(false);
          expect(exists(path.join(paths.dirPath, "background.ndjson"))).toBe(false);
          expect(modeOf(paths.dirPath)).toBe(0o700);
        });
      });

      describe("narrowLegacyLogs()", () => {
        it("narrows both log generations an older build left world-readable (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true, mode: 0o755 });
          await fs.writeFile(paths.logPath, "old prompts\n", { mode: 0o644 });
          await fs.writeFile(paths.rotatedPath, "older prompts\n", { mode: 0o644 });

          await new FrameSink({ vaultBasePath: "/vault", runtime }).narrowLegacyLogs();

          expect(modeOf(paths.logPath)).toBe(0o600);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
          expect(await fs.readFile(paths.logPath, "utf8")).toBe("old prompts\n");
          expect(await fs.readFile(paths.rotatedPath, "utf8")).toBe("older prompts\n");
        });

        it("creates nothing when no log was ever written (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);

          await new FrameSink({ vaultBasePath: "/vault", runtime }).narrowLegacyLogs();

          expect(exists(paths.dirPath)).toBe(false);
          expect(exists(paths.logPath)).toBe(false);
        });

        it("leaves a legacy log owned by another user untouched (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "not ours\n", { mode: 0o644 });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.logPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          await new FrameSink({ vaultBasePath: "/vault", runtime }).narrowLegacyLogs();

          expect(modeOf(paths.logPath)).toBe(0o644);
        });

        it("still narrows the rotated log when the active one cannot be secured (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "not ours\n", { mode: 0o644 });
          await fs.writeFile(paths.rotatedPath, "ours, older\n", { mode: 0o644 });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.logPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          await new FrameSink({ vaultBasePath: "/vault", runtime }).narrowLegacyLogs();

          expect(modeOf(paths.logPath)).toBe(0o644);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
        });
      });

      describe("clear()", () => {
        it("does not delete through a symlink squatting the leaf directory (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const victim = path.join(tmpBase, "victim");
          await fs.mkdir(victim, { recursive: true });
          const victimLog = path.join(victim, "acp-frames.ndjson");
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
