import {
  findLatestOpencodeLog,
  opencodeLogDir,
  type OpencodeLogRuntime,
} from "@/utils/opencodeLog";

const join = (...parts: string[]) => parts.join("/");

describe("opencodeLogDir", () => {
  it("uses XDG_DATA_HOME when set", () => {
    expect(opencodeLogDir({ XDG_DATA_HOME: "/xdg/data" }, "/home/me", join)).toBe(
      "/xdg/data/opencode/log"
    );
  });

  it("falls back to ~/.local/share when XDG_DATA_HOME is unset", () => {
    expect(opencodeLogDir({}, "/home/me", join)).toBe("/home/me/.local/share/opencode/log");
  });

  it("ignores a whitespace-only XDG_DATA_HOME", () => {
    expect(opencodeLogDir({ XDG_DATA_HOME: "   " }, "/home/me", join)).toBe(
      "/home/me/.local/share/opencode/log"
    );
  });
});

describe("findLatestOpencodeLog", () => {
  function makeRuntime(
    files: string[],
    mtimes: Record<string, number>,
    overrides: Partial<OpencodeLogRuntime> = {}
  ): OpencodeLogRuntime {
    return {
      join,
      readdir: async () => files,
      stat: async (p) => ({ mtimeMs: mtimes[p] ?? 0 }),
      ...overrides,
    };
  }

  it("returns the newest .log file by mtime", async () => {
    const runtime = makeRuntime(["a.log", "b.log", "notes.txt"], {
      "/home/me/.local/share/opencode/log/a.log": 100,
      "/home/me/.local/share/opencode/log/b.log": 200,
    });
    const result = await findLatestOpencodeLog({}, "/home/me", runtime);
    expect(result).toBe("/home/me/.local/share/opencode/log/b.log");
  });

  it("returns null when there are no .log files", async () => {
    const runtime = makeRuntime(["readme.md", "x.json"], {});
    expect(await findLatestOpencodeLog({}, "/home/me", runtime)).toBeNull();
  });

  it("returns null when the directory cannot be read", async () => {
    const runtime = makeRuntime(
      [],
      {},
      {
        readdir: async () => {
          throw new Error("ENOENT");
        },
      }
    );
    expect(await findLatestOpencodeLog({}, "/home/me", runtime)).toBeNull();
  });

  it("skips files that vanish between readdir and stat", async () => {
    const runtime = makeRuntime(
      ["gone.log", "here.log"],
      {
        "/home/me/.local/share/opencode/log/here.log": 50,
      },
      {
        stat: async (p) => {
          if (p.endsWith("gone.log")) throw new Error("ENOENT");
          return { mtimeMs: 50 };
        },
      }
    );
    const result = await findLatestOpencodeLog({}, "/home/me", runtime);
    expect(result).toBe("/home/me/.local/share/opencode/log/here.log");
  });
});
