import { TFile, type Vault } from "obsidian";
import { createVaultMcpServer, globToRegex } from "./vaultMcpServer";

/**
 * The vault MCP server returns a tagged config that wraps a server
 * `instance` whose `tools` array each carry a `handler` (per the SDK shape
 * mocked in __mocks__/@anthropic-ai/claude-agent-sdk.js). Tests reach into
 * that handler directly and feed it a fake Vault.
 */
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
function getTool(server: unknown, name: string): ToolHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (server as any).instance.tools as Array<{ name: string; handler: ToolHandler }>;
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} not found`);
  return t.handler;
}

interface FakeVault extends Vault {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modify: jest.Mock<Promise<void>, [any, string]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: jest.Mock<Promise<any>, [string, string]>;
  adapterWrite: jest.Mock<Promise<void>, [string, string]>;
}

function fakeVault(files: Record<string, string>): FakeVault {
  const reads = files;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tfiles = new Map<string, any>(
    Object.keys(reads).map((p) => {
      const f = new (TFile as unknown as new (path: string) => unknown)(p);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f as any).path = p;
      return [p, f];
    })
  );
  const adapterWrite = jest.fn(async (p: string, content: string) => {
    reads[p] = content;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modify = jest.fn(async (file: any, content: string) => {
    reads[file.path] = content;
  });
  const create = jest.fn(async (p: string, content: string) => {
    reads[p] = content;
    const f = new (TFile as unknown as new (path: string) => unknown)(p);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f as any).path = p;
    tfiles.set(p, f);
    return f;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: any = {
    adapter: {
      read: async (p: string) => {
        if (!(p in reads)) throw new Error(`ENOENT ${p}`);
        return reads[p];
      },
      write: adapterWrite,
      list: async (p: string) => {
        const prefix = p ? `${p.replace(/\/$/, "")}/` : "";
        const entries = Object.keys(reads).filter((k) => k.startsWith(prefix));
        const folders = new Set<string>();
        const fileSet = new Set<string>();
        for (const k of entries) {
          const rest = k.slice(prefix.length);
          const slash = rest.indexOf("/");
          if (slash >= 0) folders.add(`${prefix}${rest.slice(0, slash)}`);
          else fileSet.add(k);
        }
        return { folders: [...folders], files: [...fileSet] };
      },
    },
    getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
    modify,
    create,
    cachedRead: async (file: { path: string }) => {
      if (!(file.path in reads)) throw new Error(`ENOENT ${file.path}`);
      return reads[file.path];
    },
    getMarkdownFiles: () =>
      Object.keys(reads)
        .filter((p) => p.endsWith(".md"))
        .map((p) => ({ path: p })),
  };
  v.adapterWrite = adapterWrite;
  return v as FakeVault;
}

describe("vault MCP tools", () => {
  it("vault_read returns file contents", async () => {
    const v = fakeVault({ "a.md": "hello" });
    const server = createVaultMcpServer(v);
    const out = await getTool(server, "vault_read")({ path: "a.md" }, {});
    expect(out).toEqual({ content: [{ type: "text", text: "hello" }] });
  });

  it("vault_write creates a new note via vault.create (firing Obsidian events)", async () => {
    const files: Record<string, string> = {};
    const v = fakeVault(files);
    const server = createVaultMcpServer(v);
    await getTool(server, "vault_write")({ path: "new.md", content: "abc" }, {});
    expect(files["new.md"]).toBe("abc");
    expect(v.create).toHaveBeenCalledWith("new.md", "abc");
    expect(v.modify).not.toHaveBeenCalled();
    expect(v.adapterWrite).not.toHaveBeenCalled();
  });

  it("vault_write overwrites an existing note via vault.modify", async () => {
    const files = { "x.md": "old" };
    const v = fakeVault(files);
    const server = createVaultMcpServer(v);
    await getTool(server, "vault_write")({ path: "x.md", content: "new" }, {});
    expect(files["x.md"]).toBe("new");
    expect(v.modify).toHaveBeenCalledTimes(1);
    expect(v.create).not.toHaveBeenCalled();
    expect(v.adapterWrite).not.toHaveBeenCalled();
  });

  it("vault_edit replaces a single occurrence via vault.modify", async () => {
    const files = { "a.md": "hello world hello" };
    const v = fakeVault(files);
    const server = createVaultMcpServer(v);
    const result = (await getTool(server, "vault_edit")(
      { path: "a.md", old_string: "world", new_string: "vault" },
      {}
    )) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(files["a.md"]).toBe("hello vault hello");
    expect(v.modify).toHaveBeenCalledTimes(1);
    expect(v.adapterWrite).not.toHaveBeenCalled();
  });

  it("vault_edit fails when old_string appears multiple times without replace_all", async () => {
    const files = { "a.md": "hello hello" };
    const v = fakeVault(files);
    const server = createVaultMcpServer(v);
    const result = (await getTool(server, "vault_edit")(
      { path: "a.md", old_string: "hello", new_string: "world" },
      {}
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(files["a.md"]).toBe("hello hello"); // unchanged
  });

  it("vault_edit replaces all when replace_all: true", async () => {
    const files = { "a.md": "hello hello" };
    const v = fakeVault(files);
    const server = createVaultMcpServer(v);
    await getTool(server, "vault_edit")(
      { path: "a.md", old_string: "hello", new_string: "world", replace_all: true },
      {}
    );
    expect(files["a.md"]).toBe("world world");
  });

  it("vault_edit fails on missing old_string", async () => {
    const files = { "a.md": "hello" };
    const v = fakeVault(files);
    const server = createVaultMcpServer(v);
    const result = (await getTool(server, "vault_edit")(
      { path: "a.md", old_string: "nope", new_string: "yes" },
      {}
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("vault_glob matches paths against the pattern", async () => {
    const v = fakeVault({ "Daily/2026-05-01.md": "x", "Notes/idea.md": "y" });
    const server = createVaultMcpServer(v);
    const out = (await getTool(server, "vault_glob")({ pattern: "Daily/**/*.md" }, {})) as {
      content: Array<{ text: string }>;
    };
    expect(out.content[0].text).toBe("Daily/2026-05-01.md");
  });

  it("vault_grep finds lines matching a regex", async () => {
    const v = fakeVault({ "a.md": "first line\nfoo bar\nbaz" });
    const server = createVaultMcpServer(v);
    const out = (await getTool(server, "vault_grep")({ pattern: "^foo" }, {})) as {
      content: Array<{ text: string }>;
    };
    expect(out.content[0].text).toContain("a.md:2: foo bar");
  });
});

describe("globToRegex", () => {
  it("matches `**` across slashes", () => {
    expect(globToRegex("Daily/**/*.md").test("Daily/2026/05/01.md")).toBe(true);
    expect(globToRegex("Daily/**/*.md").test("Notes/x.md")).toBe(false);
  });

  it("matches `*` within a path segment only", () => {
    expect(globToRegex("Notes/*.md").test("Notes/x.md")).toBe(true);
    expect(globToRegex("Notes/*.md").test("Notes/sub/x.md")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    expect(globToRegex("a.b").test("a.b")).toBe(true);
    expect(globToRegex("a.b").test("aXb")).toBe(false);
  });
});
