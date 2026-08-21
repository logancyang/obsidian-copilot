import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FrameRecord, FrameSink, getFrameLogPaths, NodeRuntime } from "./debugSink";

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

/** Create an in-memory runtime for exercising the frame sink without disk IO. */
function makeRuntime(tmpDir = "/tmp", tempRootMode = 0o1755): FakeRuntime {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const removedPaths: string[] = [];
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
    }),
    writeFile: jest.fn(async (path, data) => {
      files.set(path, data);
    }),
    rm: jest.fn(async (path) => {
      removedPaths.push(path);
      files.delete(path);
      directories.delete(path);
    }),
    stat: jest.fn(async (path) => {
      const data = files.get(path);
      if (data === undefined) throw errno("ENOENT");
      return { size: data.length };
    }),
    rename: jest.fn(async (oldPath, newPath) => {
      const data = files.get(oldPath);
      if (data === undefined) throw errno("ENOENT");
      files.set(newPath, data);
      files.delete(oldPath);
    }),
    chmod: jest.fn(async () => undefined),
    // Known files are plain files, mkdir-ed paths plain directories, anything
    // else ENOENT — all owned by uid 1000, so path validation passes and the
    // queueing tests stay focused. Squatting scenarios live in the real-fs
    // groups below.
    lstat: jest.fn(async (path: string) => {
      // Root directory: always owned by root (uid 0), mode 0755.
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

/** Real-fs NodeRuntime mirroring production `getNodeRuntime`, pinned to a temp base. */
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
    rename: fs.rename,
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

        const log = runtime.files.get(paths.logPath) ?? "";
        expect(log.length).toBeLessThan(5_000);
        expect(log).toContain('"__truncated":true');
        expect(log).toContain("sessionUpdate=tool_call_update");
        expect(log).toContain("toolCallId=call-1");
      });

      // POSIX-only: on win32 the sink skips ownership and mode validation
      // entirely, so none of these refusals apply.
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
            // Only the temp root is unsafe; every level below it stays valid, so
            // a frame that still gets written proves the temp-root check is what
            // stopped it.
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

            // A refusal is never cached, so a temp root that becomes safe starts
            // logging again without restarting the plugin.
            lstat.mockImplementation(safeLstat);
            sink.append(makeFrame({ id: "third" }));
            await sink.flush();
            expect(runtime.files.get(paths.logPath)).toContain('"id":"third"');
          }
        );

        it("logs under a root-owned sticky temp root, the shape of a standard Linux /tmp (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRuntime();
          const paths = getFrameLogPaths("/vault", runtime);
          const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
          const safeLstat = lstat.getMockImplementation()!;
          // Linux ships /tmp as uid 0, mode 1777: owned by neither us nor any
          // attacker, and world-writable but sticky. Both allowances are load
          // bearing — tightening either one stops every Linux install from
          // logging, which no refusal case can catch.
          lstat.mockImplementation(async (target: string) =>
            target === runtime.tmpdir()
              ? { uid: 0, mode: 0o1777, isDirectory: true, isSymbolicLink: false }
              : safeLstat(target)
          );
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

          sink.append(makeFrame({ id: "linux-tmp" }));
          await sink.flush();

          expect(runtime.files.get(paths.logPath)).toContain('"id":"linux-tmp"');
        });
      });

      it("refuses a level that is still not a real directory after creating it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const paths = getFrameLogPaths("/vault", runtime);
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        const safeLstat = lstat.getMockImplementation()!;
        // mkdir reports success, but re-inspecting the level finds a symlink —
        // the race a squatter wins between the two calls.
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

        // Unlike a symlink, a directory may hold content its owner needs, so it
        // is refused rather than removed.
        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.rm).not.toHaveBeenCalled();
      });

      it("drops the frame instead of writing when path validation fails, then recovers (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        // First ensure pass dies on an unreadable path — e.g. a directory the
        // sink may not traverse. Nothing may be written in response.
        lstat.mockRejectedValueOnce(errno("EACCES"));
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);

        sink.append(makeFrame({ id: "first" }));
        await sink.flush();
        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.writeFile).not.toHaveBeenCalled();

        // The failed ensure was not cached: the next frame re-validates and
        // lands normally.
        sink.append(makeFrame({ id: "second" }));
        await sink.flush();
        expect(runtime.files.get(paths.logPath)).toContain('"id":"second"');
      });
    });

    describe("clear()", () => {
      it("clears active and rotated log files", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
        const paths = getFrameLogPaths("/vault", runtime);
        runtime.files.set(paths.logPath, "active");
        runtime.files.set(paths.rotatedPath, "old");

        await sink.clear();

        expect(runtime.files.has(paths.logPath)).toBe(false);
        expect(runtime.files.has(paths.rotatedPath)).toBe(false);
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

    // The groups below re-exercise append()/open()/clear() against the REAL
    // filesystem, proving the frame log's owner-only permission boundary:
    // mode bits under several umasks, narrowing of paths left permissive by
    // older builds, and squatted-path containment — none of which the
    // in-memory runtime can prove.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/250
    // They stay separate same-callable groups (as AGENTS.md's lifecycle
    // exception allows) because they carry a material lifecycle of their own:
    // a per-test mkdtemp sandbox, process-umask save/restore, and a
    // POSIX-only skip (win32 has no POSIX mode bits).
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

            expect(exists(paths.logPath)).toBe(true);
            // Every level of the predictable chain is owner-only, not just the leaf.
            expect(modeOf(paths.dirPath)).toBe(0o700);
            expect(modeOf(path.dirname(paths.dirPath))).toBe(0o700);
            expect(modeOf(path.dirname(path.dirname(paths.dirPath)))).toBe(0o700);
            expect(modeOf(paths.logPath)).toBe(0o600);
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
          expect(modeOf(paths.logPath)).toBe(0o600);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
          // The pre-existing content survived — narrowing must not truncate.
          const content = await fs.readFile(paths.logPath, "utf8");
          expect(content).toContain("old-active");
          expect(content).toContain('"session/update"');
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

          // The victim directory never received the log file.
          expect(exists(path.join(victim, "acp-frames.ndjson"))).toBe(false);
          // The squatting link was replaced by a real owner-only directory.
          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isSymbolicLink()).toBe(false);
          expect(leaf.isDirectory()).toBe(true);
          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });

        it("refuses a plain file squatting a directory level without deleting it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          // A plain file may be content someone owns — unlike a symlink it is
          // never removed; the sink fails closed instead.
          await fs.writeFile(paths.dirPath, "someone's data", { mode: 0o644 });

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isFile()).toBe(true);
          expect(await fs.readFile(paths.dirPath, "utf8")).toBe("someone's data");
          // Refusing means leaving it exactly as found: a sink that walked past
          // this and narrowed the squatter would rewrite another user's mode.
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
          expect(modeOf(paths.logPath)).toBe(0o600);
        });

        it("removes a symlink squatting the log file itself and leaves its target untouched (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const victimFile = path.join(tmpBase, "victim.txt");
          await fs.writeFile(victimFile, "victim-content", { mode: 0o644 });
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.symlink(victimFile, paths.logPath);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          // The victim was neither chmodded nor appended to.
          expect(await fs.readFile(victimFile, "utf8")).toBe("victim-content");
          expect(modeOf(victimFile)).toBe(0o644);
          // The log landed in a fresh private regular file.
          const log = await fs.lstat(paths.logPath);
          expect(log.isSymbolicLink()).toBe(false);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });

        it("refuses to write into a directory owned by another user instead of falling back (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          // The on-disk uid can't differ without root, so report a foreign owner
          // for the leaf directory alone. Shifting the runtime's whole idea of
          // the current uid would make the temp root look foreign too, and the
          // refusal under test would never be reached.
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.dirPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          // No write landed anywhere — in particular no fallback recreate.
          expect(exists(paths.logPath)).toBe(false);
          expect(exists(paths.rotatedPath)).toBe(false);
        });

        it("leaves a log file owned by another user unread and unnarrowed (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "someone else's frames\n", { mode: 0o644 });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.logPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          sink.append(makeFrame());
          await sink.flush();

          // Narrowing a file we do not own would rewrite its owner's mode, and
          // appending would mix our frames into their file.
          expect(await fs.readFile(paths.logPath, "utf8")).toBe("someone else's frames\n");
          expect(modeOf(paths.logPath)).toBe(0o644);
        });

        it("creates the fresh post-rotation file 0600 (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          // A sparse active file already past the rotation threshold.
          await fs.writeFile(paths.logPath, "", { mode: 0o644 });
          await fs.truncate(paths.logPath, 51 * 1024 * 1024);

          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
          // ROTATE_CHECK_EVERY (25) writes trigger the stat check and rename;
          // one more lands in the freshly created active file.
          for (let i = 0; i < 26; i++) sink.append(makeFrame({ id: String(i) }));
          await sink.flush();

          expect(exists(paths.rotatedPath)).toBe(true);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });
      });

      describe("open()", () => {
        it("creates a missing log file 0600 before opening it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);
          const sink = new FrameSink({ vaultBasePath: "/vault", runtime });

          await sink.open();

          expect(exists(paths.logPath)).toBe(true);
          expect(modeOf(paths.logPath)).toBe(0o600);
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
          // Narrowing must not cost the diagnostic history it is protecting.
          expect(await fs.readFile(paths.logPath, "utf8")).toBe("old prompts\n");
        });

        it("creates nothing when no log was ever written (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths("/vault", runtime);

          await new FrameSink({ vaultBasePath: "/vault", runtime }).narrowLegacyLogs();

          // This runs on every desktop startup, so someone who never enables
          // frame logging must not find a temp directory made on their behalf.
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

          // Each generation stands alone: an entry this sink must refuse says
          // nothing about the other, which is still the user's own plaintext.
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
