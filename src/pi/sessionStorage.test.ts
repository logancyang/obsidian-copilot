import type { PiFileStore } from "@/pi/types";
import {
  createPiFileSystem,
  createPiSession,
  openPiSession,
  piSessionPath,
} from "./sessionStorage";

function memoryStore(
  seed: Record<string, string> = {}
): PiFileStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    dir: "config/plugins/copilot/pi-sessions",
    read: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`${path} does not exist`);
      return content;
    },
    write: async (path, content) => {
      files.set(path, content);
    },
    append: async (path, content) => {
      files.set(path, (files.get(path) ?? "") + content);
    },
    mkdir: async () => undefined,
    exists: async (path) => files.has(path),
  };
}

describe("piSessionStorage", () => {
  describe("piSessionPath()", () => {
    it("addresses one transcript per conversation inside the resolved folder", () => {
      expect(piSessionPath("some/dir", "abc-123")).toBe("some/dir/abc-123.jsonl");
    });
  });

  describe("createPiFileSystem()", () => {
    it("reads a file back as a result value", async () => {
      const fs = createPiFileSystem(memoryStore({ "a.jsonl": "line1\nline2" }));

      await expect(fs.readTextFile("a.jsonl")).resolves.toEqual({
        ok: true,
        value: "line1\nline2",
      });
    });

    it("reports a missing file as not_found rather than throwing", async () => {
      const fs = createPiFileSystem(memoryStore());

      const result = await fs.readTextFile("missing.jsonl");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_found");
    });

    it("splits lines and honors the caller's line budget", async () => {
      const fs = createPiFileSystem(memoryStore({ "a.jsonl": "1\n2\n3" }));

      await expect(fs.readTextLines("a.jsonl", { maxLines: 2 })).resolves.toEqual({
        ok: true,
        value: ["1", "2"],
      });
    });

    it("creates the transcript folder before writing or appending", async () => {
      const store = memoryStore();
      const mkdir = jest.spyOn(store, "mkdir");
      const fs = createPiFileSystem(store);

      await fs.writeFile("a.jsonl", "x");
      await fs.appendFile("a.jsonl", "y");

      expect(mkdir).toHaveBeenCalledWith("config/plugins/copilot/pi-sessions");
      expect(store.files.get("a.jsonl")).toBe("xy");
    });

    it("decodes binary content, since pi may hand over bytes", async () => {
      const store = memoryStore();
      const fs = createPiFileSystem(store);

      await fs.writeFile("a.jsonl", new TextEncoder().encode("bytes"));

      expect(store.files.get("a.jsonl")).toBe("bytes");
    });

    it("surfaces an unexpected failure without mislabeling it as missing", async () => {
      const store = memoryStore();
      store.write = () => Promise.reject(new Error("disk full"));
      const fs = createPiFileSystem(store);

      const result = await fs.writeFile("a.jsonl", "x");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("unknown");
    });
  });

  describe("createPiSession()", () => {
    it("writes the transcript where the conversation id says it goes", async () => {
      const store = memoryStore();

      await createPiSession(store, "s1");

      expect(store.files.has(piSessionPath(store.dir, "s1"))).toBe(true);
    });
  });

  describe("openPiSession()", () => {
    it("rejects when the conversation has no transcript on this device", async () => {
      await expect(openPiSession(memoryStore(), "gone")).rejects.toThrow();
    });

    it("reopens a transcript that exists", async () => {
      const store = memoryStore();
      await createPiSession(store, "s1");

      await expect(openPiSession(store, "s1")).resolves.toBeDefined();
    });
  });
});
