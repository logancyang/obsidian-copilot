import { FileSystemAdapter, App } from "obsidian";
import { getSettings } from "@/settings/model";
import { sliceLines, VaultClient } from "./VaultClient";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ copilotFolder: "copilot" })),
}));

type MockAdapter = { read: jest.Mock; exists: jest.Mock; mkdir: jest.Mock; write: jest.Mock };

function buildApp(basePath = "/vault"): { app: App; adapter: MockAdapter } {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(
    basePath
  ) as MockAdapter;
  return { app: { vault: { adapter } } as unknown as App, adapter };
}

function buildClient(
  app: App,
  onSessionUpdate: (sessionId: string, update: unknown) => void = () => {}
): VaultClient {
  return new VaultClient(app, {
    onSessionUpdate,
    requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
  });
}

describe("VaultClient", () => {
  describe("sliceLines()", () => {
    const text = "a\nb\nc\nd\ne";

    it("returns the full content when both line and limit are null", () => {
      expect(sliceLines(text, null, null)).toBe(text);
    });

    it("returns from line N (1-based) to the end when limit is null", () => {
      expect(sliceLines(text, 3, null)).toBe("c\nd\ne");
    });

    it("returns the first N lines when line is null", () => {
      expect(sliceLines(text, null, 2)).toBe("a\nb");
    });

    it("returns limit lines starting at line when both are given", () => {
      expect(sliceLines(text, 2, 2)).toBe("b\nc");
    });

    it("clamps the limit to the end of the content", () => {
      expect(sliceLines(text, 4, 100)).toBe("d\ne");
    });

    it("returns an empty string when line is past the end", () => {
      expect(sliceLines(text, 99, 5)).toBe("");
    });
  });

  describe("VaultClient", () => {
    describe("readTextFile()", () => {
      it("reads the vault-relative file through the adapter and applies line and limit", async () => {
        const { app, adapter } = buildApp();
        adapter.read.mockResolvedValue("one\ntwo\nthree\nfour");

        const resp = await buildClient(app).readTextFile({
          sessionId: "s1",
          path: "notes/foo.md",
          line: 2,
          limit: 2,
        });

        expect(resp.content).toBe("two\nthree");
        expect(adapter.read).toHaveBeenCalledWith("notes/foo.md");
      });

      it("reads an absolute path inside the vault as a vault-relative path", async () => {
        const { app, adapter } = buildApp("/Users/me/vault");
        adapter.read.mockResolvedValue("hello");

        const resp = await buildClient(app).readTextFile({
          sessionId: "s1",
          path: "/Users/me/vault/notes/foo.md",
        });

        expect(resp.content).toBe("hello");
        expect(adapter.read).toHaveBeenCalledWith("notes/foo.md");
      });

      it("rejects a relative path that traverses out of the vault with ..", async () => {
        const { app } = buildApp("/Users/me/vault");

        await expect(
          buildClient(app).readTextFile({ sessionId: "s1", path: "../outside.md" })
        ).rejects.toThrow(/outside the vault/);
      });

      it("rejects an absolute path outside the vault base", async () => {
        const { app } = buildApp("/Users/me/vault");

        await expect(
          buildClient(app).readTextFile({ sessionId: "s1", path: "/etc/passwd" })
        ).rejects.toThrow(/outside the vault/);
      });

      it("rejects a path in a hidden directory such as the Obsidian config folder", async () => {
        const { app } = buildApp("/Users/me/vault");

        await expect(
          buildClient(app).readTextFile({
            sessionId: "s1",
            // eslint-disable-next-line obsidianmd/hardcoded-config-path -- test fixture for hidden-dir guard
            path: ".obsidian/plugins/copilot/data.json",
          })
        ).rejects.toThrow(/hidden directory/);
      });

      it("allows the configured hidden Copilot root while keeping other hidden roots blocked for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
        jest
          .mocked(getSettings)
          .mockReturnValue({ copilotFolder: ".copilot-logs" } as ReturnType<typeof getSettings>);
        const { app, adapter } = buildApp("/Users/me/vault");
        adapter.read.mockResolvedValue("skill content");
        const client = buildClient(app);

        await expect(
          client.readTextFile({ sessionId: "s1", path: ".copilot-logs/skills/example.md" })
        ).resolves.toEqual({ content: "skill content" });
        await expect(
          client.readTextFile({ sessionId: "s1", path: ".other-private-folder/notes.md" })
        ).rejects.toThrow(/hidden directory/);
      });
    });

    describe("writeTextFile()", () => {
      it("creates the missing parent directory before writing the file", async () => {
        const { app, adapter } = buildApp();
        adapter.exists.mockResolvedValueOnce(false);
        adapter.write.mockResolvedValue(undefined);

        await buildClient(app).writeTextFile({
          sessionId: "s1",
          path: "Inbox/note.md",
          content: "hi",
        });

        expect(adapter.mkdir).toHaveBeenCalledWith("Inbox");
        expect(adapter.write).toHaveBeenCalledWith("Inbox/note.md", "hi");
      });

      it("rejects a path in a hidden directory without writing", async () => {
        const { app, adapter } = buildApp("/Users/me/vault");

        await expect(
          buildClient(app).writeTextFile({ sessionId: "s1", path: ".git/config", content: "x" })
        ).rejects.toThrow(/hidden directory/);
        expect(adapter.write).not.toHaveBeenCalled();
      });
    });

    describe("sessionUpdate()", () => {
      const update = {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        },
      } as unknown as Parameters<VaultClient["sessionUpdate"]>[0];

      it("forwards the notification to the session update handler with its session id", async () => {
        const onSessionUpdate = jest.fn();

        await buildClient(buildApp().app, onSessionUpdate).sessionUpdate(update);

        expect(onSessionUpdate).toHaveBeenCalledWith("s1", update);
      });

      it("resolves without throwing when the handler throws", async () => {
        const onSessionUpdate = jest.fn(() => {
          throw new Error("handler blew up");
        });

        await expect(
          buildClient(buildApp().app, onSessionUpdate).sessionUpdate(update)
        ).resolves.toBeUndefined();
      });
    });
  });
});
