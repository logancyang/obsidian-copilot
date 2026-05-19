import { FrameSink, getFrameLogPaths, NodeRuntime } from "./debugSink";

interface FakeRuntime extends NodeRuntime {
  files: Map<string, string>;
  removedPaths: string[];
}

/** Create an in-memory runtime for exercising the frame sink without disk IO. */
function makeRuntime(tmpDir = "/tmp"): FakeRuntime {
  const files = new Map<string, string>();
  const removedPaths: string[] = [];
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
  return {
    files,
    removedPaths,
    tmpdir: () => tmpDir,
    join,
    dirname: (path) => path.slice(0, path.lastIndexOf("/")) || "/",
    mkdir: jest.fn(async () => undefined),
    appendFile: jest.fn(async (path, data) => {
      files.set(path, (files.get(path) ?? "") + data);
    }),
    writeFile: jest.fn(async (path, data) => {
      files.set(path, data);
    }),
    rm: jest.fn(async (path) => {
      removedPaths.push(path);
      files.delete(path);
    }),
    stat: jest.fn(async (path) => {
      const data = files.get(path);
      if (data === undefined) throw new Error("ENOENT");
      return { size: data.length };
    }),
    rename: jest.fn(async (oldPath, newPath) => {
      const data = files.get(oldPath);
      if (data === undefined) throw new Error("ENOENT");
      files.set(newPath, data);
      files.delete(oldPath);
    }),
    openPath: jest.fn(async () => ""),
  };
}

describe("FrameSink", () => {
  it("stores frame logs in a per-vault temp directory", () => {
    const runtime = makeRuntime("C:/Users/zero/AppData/Local/Temp");
    const first = getFrameLogPaths("C:/Users/zero/Vault", runtime);
    const second = getFrameLogPaths("C:/Users/zero/OtherVault", runtime);

    expect(first.logPath).toContain("/obsidian-copilot/acp-frames/");
    expect(first.logPath).toMatch(/\/acp-frames\.ndjson$/);
    expect(first.rotatedPath).toMatch(/\/acp-frames\.old\.ndjson$/);
    expect(first.dirPath).not.toBe(second.dirPath);
  });

  it("summarizes oversized frames before appending", async () => {
    const runtime = makeRuntime();
    const sink = new FrameSink({ vaultBasePath: "/vault", runtime });
    const paths = getFrameLogPaths("/vault", runtime);

    sink.append({
      ts: "2026-05-12T00:00:00.000Z",
      dir: "←",
      tag: "codex",
      kind: "notif",
      method: "session/update",
      id: null,
      payload: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
        },
        content: "x".repeat(100_000),
      },
    });
    await sink.flush();

    const log = runtime.files.get(paths.logPath) ?? "";
    expect(log.length).toBeLessThan(5_000);
    expect(log).toContain('"__truncated":true');
    expect(log).toContain("sessionUpdate=tool_call_update");
    expect(log).toContain("toolCallId=call-1");
  });

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
});
