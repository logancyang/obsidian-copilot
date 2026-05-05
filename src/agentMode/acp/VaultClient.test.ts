import { FileSystemAdapter, App } from "obsidian";
import { sliceLines, VaultClient } from "./VaultClient";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("sliceLines", () => {
  const text = "a\nb\nc\nd\ne";

  it("returns full content when both line and limit are null", () => {
    expect(sliceLines(text, null, null)).toBe(text);
  });

  it("returns from line N (1-based) to end when limit is null", () => {
    expect(sliceLines(text, 3, null)).toBe("c\nd\ne");
  });

  it("returns first N lines when line is null", () => {
    expect(sliceLines(text, null, 2)).toBe("a\nb");
  });

  it("respects both line and limit", () => {
    expect(sliceLines(text, 2, 2)).toBe("b\nc");
  });

  it("returns empty string when line is past end", () => {
    expect(sliceLines(text, 99, 5)).toBe("");
  });

  it("clamps limit when it overruns", () => {
    expect(sliceLines(text, 4, 100)).toBe("d\ne");
  });
});

describe("VaultClient", () => {
  function buildApp(basePath = "/vault"): App {
    // The mocked FileSystemAdapter takes the basePath via constructor; the
    // real Obsidian type has a no-arg constructor, hence the cast.
    const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(
      basePath
    );
    return { vault: { adapter } } as unknown as App;
  }

  it("readTextFile reads via adapter and applies line/limit", async () => {
    const app = buildApp();
    (app.vault.adapter as unknown as { read: jest.Mock }).read.mockResolvedValue(
      "one\ntwo\nthree\nfour"
    );
    const client = new VaultClient(app, {
      onSessionUpdate: () => {},
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    const resp = await client.readTextFile({
      sessionId: "s1",
      path: "notes/foo.md",
      line: 2,
      limit: 2,
    });
    expect(resp.content).toBe("two\nthree");
    expect((app.vault.adapter as unknown as { read: jest.Mock }).read).toHaveBeenCalledWith(
      "notes/foo.md"
    );
  });

  it("rejects out-of-vault relative paths with .. traversal", async () => {
    const app = buildApp("/Users/me/vault");
    const client = new VaultClient(app, {
      onSessionUpdate: () => {},
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    await expect(client.readTextFile({ sessionId: "s1", path: "../outside.md" })).rejects.toThrow(
      /outside the vault/
    );
  });

  it("rejects dotfile paths under the vault (e.g. .obsidian config)", async () => {
    const app = buildApp("/Users/me/vault");
    const client = new VaultClient(app, {
      onSessionUpdate: () => {},
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    await expect(
      client.readTextFile({ sessionId: "s1", path: ".obsidian/plugins/copilot/data.json" })
    ).rejects.toThrow(/hidden directory/);
    await expect(
      client.writeTextFile({ sessionId: "s1", path: ".git/config", content: "x" })
    ).rejects.toThrow(/hidden directory/);
  });

  it("rejects absolute paths outside the vault base", async () => {
    const app = buildApp("/Users/me/vault");
    const client = new VaultClient(app, {
      onSessionUpdate: () => {},
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    await expect(client.readTextFile({ sessionId: "s1", path: "/etc/passwd" })).rejects.toThrow(
      /outside the vault/
    );
  });

  it("accepts absolute paths inside the vault base and routes to adapter as relative", async () => {
    const app = buildApp("/Users/me/vault");
    (app.vault.adapter as unknown as { read: jest.Mock }).read.mockResolvedValue("hello");
    const client = new VaultClient(app, {
      onSessionUpdate: () => {},
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    const resp = await client.readTextFile({
      sessionId: "s1",
      path: "/Users/me/vault/notes/foo.md",
    });
    expect(resp.content).toBe("hello");
    expect((app.vault.adapter as unknown as { read: jest.Mock }).read).toHaveBeenCalledWith(
      "notes/foo.md"
    );
  });

  it("writeTextFile creates parent dir if missing", async () => {
    const app = buildApp();
    const adapter = app.vault.adapter as unknown as {
      exists: jest.Mock;
      mkdir: jest.Mock;
      write: jest.Mock;
    };
    adapter.exists.mockResolvedValueOnce(false);
    adapter.write.mockResolvedValue(undefined);
    const client = new VaultClient(app, {
      onSessionUpdate: () => {},
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    await client.writeTextFile({
      sessionId: "s1",
      path: "Inbox/note.md",
      content: "hi",
    });
    expect(adapter.mkdir).toHaveBeenCalledWith("Inbox");
    expect(adapter.write).toHaveBeenCalledWith("Inbox/note.md", "hi");
  });

  it("sessionUpdate forwards to handler", async () => {
    const app = buildApp();
    const onSessionUpdate = jest.fn();
    const client = new VaultClient(app, {
      onSessionUpdate,
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    });
    const update = {
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      },
    } as unknown as Parameters<typeof client.sessionUpdate>[0];
    await client.sessionUpdate(update);
    expect(onSessionUpdate).toHaveBeenCalledWith("s1", update);
  });
});
