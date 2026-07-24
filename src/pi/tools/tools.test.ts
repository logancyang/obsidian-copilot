import { activeNoteTool } from "./activeNote";
import { PI_TOOLS, type PiToolContext } from "./index";
import { readNoteTool } from "./readNote";
import { searchVaultTool } from "./searchVault";
import { webSearchTool } from "./webSearch";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function context(overrides: Partial<PiToolContext> = {}): PiToolContext {
  return {
    readActiveNote: async () => null,
    readNote: async () => null,
    searchVault: async () => [],
    webSearch: async () => "",
    ...overrides,
  };
}

describe("piTools", () => {
  describe("PI_TOOLS", () => {
    it("exposes exactly the read-only surface, in a stable order", () => {
      expect(PI_TOOLS.map((tool) => tool.name)).toEqual([
        "read_active_note",
        "read_note",
        "search_vault",
        "web_search",
      ]);
    });

    it("offers no tool that writes, deletes, or executes", () => {
      const names = PI_TOOLS.map((tool) => tool.name).join(" ");

      expect(names).not.toMatch(/write|edit|delete|bash|exec/);
    });
  });

  describe("activeNoteTool", () => {
    it("returns the open note with its path", async () => {
      const result = await activeNoteTool.execute(
        "t1",
        {},
        undefined,
        undefined,
        context({ readActiveNote: async () => ({ path: "Daily/Today.md", content: "hello" }) })
      );

      expect(textOf(result)).toContain("Daily/Today.md");
      expect(textOf(result)).toContain("hello");
    });

    it("tells the model plainly when nothing is open", async () => {
      const result = await activeNoteTool.execute("t1", {}, undefined, undefined, context());

      expect(textOf(result)).toBe("No note is currently open.");
      expect(result.details).toEqual({ path: null });
    });
  });

  describe("readNoteTool", () => {
    it("returns the note at the requested path", async () => {
      const result = await readNoteTool.execute(
        "t1",
        { path: "Notes/A.md" },
        undefined,
        undefined,
        context({ readNote: async (path) => ({ path, content: "body" }) })
      );

      expect(textOf(result)).toContain("Notes/A.md");
      expect(textOf(result)).toContain("body");
    });

    it("reports a miss with the path it tried, so the model can correct itself", async () => {
      const result = await readNoteTool.execute(
        "t1",
        { path: "Missing.md" },
        undefined,
        undefined,
        context()
      );

      expect(textOf(result)).toBe('No note found at "Missing.md".');
    });
  });

  describe("searchVaultTool", () => {
    it("renders each hit as a path heading with its excerpt", async () => {
      const result = await searchVaultTool.execute(
        "t1",
        { query: "roadmap" },
        undefined,
        undefined,
        context({
          searchVault: async () => [
            { path: "Projects/Roadmap.md", excerpt: "Q3 plans" },
            { path: "Archive/Old.md", excerpt: "older" },
          ],
        })
      );

      expect(textOf(result)).toContain("## Projects/Roadmap.md");
      expect(textOf(result)).toContain("Q3 plans");
      expect(result.details).toEqual({ hits: ["Projects/Roadmap.md", "Archive/Old.md"] });
    });

    it("says so when nothing matched rather than returning an empty blob", async () => {
      const result = await searchVaultTool.execute(
        "t1",
        { query: "nothing" },
        undefined,
        undefined,
        context()
      );

      expect(textOf(result)).toBe('No notes matched "nothing".');
    });
  });

  describe("webSearchTool", () => {
    it("returns the relay's answer", async () => {
      const result = await webSearchTool.execute(
        "t1",
        { query: "weather" },
        undefined,
        undefined,
        context({ webSearch: async (query) => `answer for ${query}` })
      );

      expect(textOf(result)).toBe("answer for weather");
      expect(result.details).toEqual({ query: "weather" });
    });

    it("propagates a relay failure so the turn reports the tool errored", async () => {
      await expect(
        webSearchTool.execute(
          "t1",
          { query: "weather" },
          undefined,
          undefined,
          context({
            webSearch: () => Promise.reject(new Error("Invalid license key")),
          })
        )
      ).rejects.toThrow("Invalid license key");
    });
  });
});
