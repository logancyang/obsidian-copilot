import { MiyoRequestError, type MiyoSearchResult } from "@/miyo/MiyoClient";
import type { CopilotSettings } from "@/settings/model";
import { MIYO_SEARCH_TOOL, runMiyoSearch, type MiyoSearchDeps } from "./miyoSearchTool";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const BASE_URL = "http://127.0.0.1:8742";

function chunk(overrides: Partial<MiyoSearchResult> & { path: string }): MiyoSearchResult {
  return {
    id: overrides.path,
    score: 1,
    chunk_index: 0,
    chunk_text: `\n\nNOTE TITLE: [[x]]\n\nNOTE BLOCK CONTENT:\n\nbody of ${overrides.path}\n`,
    ...overrides,
  };
}

function setup(
  settings: Partial<CopilotSettings> = {},
  { vaultName = "step-1", chunks = [] as MiyoSearchResult[] } = {}
) {
  const client = {
    resolveBaseUrl: jest.fn().mockResolvedValue(BASE_URL),
    search: jest.fn().mockResolvedValue({ results: chunks }),
  };
  const deps: MiyoSearchDeps = {
    client,
    getSettings: () =>
      ({
        miyoSearchAll: false,
        miyoExtraSearchFolders: [],
        miyoConnectionMode: "local",
        miyoServerUrl: "",
        ...settings,
      }) as CopilotSettings,
    getVaultName: () => vaultName,
  };
  return { client, deps };
}

describe("miyoSearchTool", () => {
  describe("MIYO_SEARCH_TOOL", () => {
    it("requires a query, accepts at most two variants, and is read-only and always loaded", () => {
      expect(MIYO_SEARCH_TOOL.inputSchema).toMatchObject({
        required: ["query"],
        properties: { variants: { type: "array", maxItems: 2 } },
      });
      expect(MIYO_SEARCH_TOOL).toMatchObject({
        annotations: { readOnlyHint: true },
        _meta: { "anthropic/alwaysLoad": true },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/736 tells the agent when to use it, how to read a result and what to do when it fails, without naming a skill or script", () => {
      const { description } = MIYO_SEARCH_TOOL;

      expect(description).toContain(
        "Use it for any request the notes might answer, alongside grep"
      );
      expect(description).toContain(
        "or everything Miyo has when Copilot's search scope is Unrestricted"
      );
      expect(description).toContain("Cite the path of any note you use");
      expect(description).toContain(
        "A note with a folder field lives in that Miyo folder outside the vault"
      );
      expect(description).toContain("If the search fails, continue with keyword search");
      expect(description).not.toMatch(/miyo-search|\.sh\b|skill/i);
    });
  });

  describe("runMiyoSearch()", () => {
    it("searches only the active vault in Current vault scope and returns the CLI's result shape without the note envelope", async () => {
      const { client, deps } = setup(
        {},
        {
          chunks: [
            chunk({ path: "step-1/notes/Trip planning.md", score: 1.5 }),
            chunk({ path: "step-1/notes/Sourdough starter.md", score: 0.6 }),
          ],
        }
      );

      const result = await runMiyoSearch({ query: "hiking trip" }, deps);

      expect(client.search).toHaveBeenCalledWith(BASE_URL, "step-1", "hiking trip", 1000, {
        variants: [],
        folderNames: undefined,
      });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({
        results: [
          {
            path: "notes/Trip planning.md",
            content: "body of step-1/notes/Trip planning.md",
          },
          {
            path: "notes/Sourdough starter.md",
            content: "body of step-1/notes/Sourdough starter.md",
          },
        ],
        count: 2,
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/735 names the active vault's notes by vault-relative path and gives notes from other Miyo folders their folder apart", async () => {
      const { deps } = setup(
        { miyoExtraSearchFolders: ["Research"] },
        {
          chunks: [
            chunk({ path: "step-1/notes/Trip planning.md" }),
            chunk({ path: "Research/papers/Sleep.md" }),
            chunk({ path: "step-10/Other.md" }),
          ],
        }
      );

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(JSON.parse(result.text).results).toEqual([
        { path: "notes/Trip planning.md", content: "body of step-1/notes/Trip planning.md" },
        {
          folder: "Research",
          path: "papers/Sleep.md",
          content: "body of Research/papers/Sleep.md",
        },
        { folder: "step-10", path: "Other.md", content: "body of step-10/Other.md" },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/735 keeps a ticked folder's note apart from a vault folder of the same name", async () => {
      const { deps } = setup(
        { miyoExtraSearchFolders: ["Research"] },
        {
          chunks: [
            chunk({ path: "step-1/Research/Sleep.md" }),
            chunk({ path: "Research/Interview.md" }),
            chunk({ path: "step-1/step-1/Nested.md" }),
          ],
        }
      );

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(
        JSON.parse(result.text).results.map(
          ({ folder, path }: { folder?: string; path: string }) => ({
            folder,
            path,
          })
        )
      ).toEqual([
        { folder: undefined, path: "Research/Sleep.md" },
        { folder: "Research", path: "Interview.md" },
        { folder: undefined, path: "step-1/Nested.md" },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/735 turns a Windows path into a forward-slash path before splitting off the folder", async () => {
      const { deps } = setup(
        {},
        {
          chunks: [
            chunk({ path: "step-1\\notes\\Trip planning.md" }),
            chunk({ path: "Research\\Sleep.md" }),
          ],
        }
      );

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(
        JSON.parse(result.text).results.map(
          ({ folder, path }: { folder?: string; path: string }) => ({
            folder,
            path,
          })
        )
      ).toEqual([
        { folder: undefined, path: "notes/Trip planning.md" },
        { folder: "Research", path: "Sleep.md" },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/735 strips the vault folder in Unrestricted scope too", async () => {
      const { deps } = setup(
        { miyoSearchAll: true },
        { chunks: [chunk({ path: "step-1/notes/Trip planning.md" })] }
      );

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(JSON.parse(result.text).results[0].path).toBe("notes/Trip planning.md");
    });

    it("returns an empty result list when Miyo finds nothing", async () => {
      const { deps } = setup();

      const result = await runMiyoSearch({ query: "nothing here" }, deps);

      expect(result).toEqual({ text: '{"results":[],"count":0}', isError: false });
    });

    it("merges one file's chunks in rank order and keeps files in Miyo's ranking", async () => {
      const { deps } = setup(
        {},
        {
          chunks: [
            chunk({ path: "step-1/b.md", chunk_text: "only" }),
            chunk({ path: "step-1/a.md", chunk_text: "better" }),
            chunk({ path: "step-1/a.md", chunk_text: "worse" }),
          ],
        }
      );

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(JSON.parse(result.text).results).toEqual([
        { path: "b.md", content: "only" },
        { path: "a.md", content: "better\n\nworse" },
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/734 still lists other notes when one note matches most chunks, and stops at 20 notes", async () => {
      const crowded = Array.from({ length: 30 }, (_, i) =>
        chunk({ path: "step-1/transcript.md", chunk_text: `part ${i}` })
      );
      const others = Array.from({ length: 25 }, (_, i) => chunk({ path: `step-1/other-${i}.md` }));
      const { deps } = setup({}, { chunks: [...crowded, ...others] });

      const { results, count } = JSON.parse((await runMiyoSearch({ query: "q" }, deps)).text) as {
        results: { path: string }[];
        count: number;
      };

      expect(count).toBe(20);
      expect(results[0].path).toBe("transcript.md");
      expect(results[1].path).toBe("other-0.md");
      expect(results[19].path).toBe("other-18.md");
    });

    it.each([
      ["quotes and newlines", '"quoted"\n' + "x".repeat(50_000)],
      ["three-byte characters", "笔记".repeat(25_000)],
    ])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/734 keeps every path and valid JSON within 32,000 bytes when the notes hold %s",
      async (_label, body) => {
        const chunks = Array.from({ length: 20 }, (_, i) =>
          chunk({ path: `step-1/note-${i}.md`, chunk_text: body })
        );
        const { deps } = setup({}, { chunks });

        const result = await runMiyoSearch({ query: "q" }, deps);

        const parsed = JSON.parse(result.text) as { results: { path: string; content: string }[] };
        expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(32_000);
        expect(result.isError).toBe(false);
        expect(parsed.results.map((r: { path: string }) => r.path)).toEqual(
          chunks.map((c) => c.path.replace("step-1/", ""))
        );
        expect(parsed.results[0].content.length).toBeGreaterThan(100);
      }
    );

    it("widens Current vault scope with the extra Miyo folders ticked in settings, leaving out the vault itself", async () => {
      const { client, deps } = setup({ miyoExtraSearchFolders: ["Research", "step-1", "ChatGPT"] });

      await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).toHaveBeenCalledWith(BASE_URL, "step-1", "q", 1000, {
        variants: [],
        folderNames: ["step-1", "Research", "ChatGPT"],
      });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 searches without a ticked folder that Miyo lacks and says so", async () => {
      const { client, deps } = setup(
        { miyoExtraSearchFolders: ["Research", "Gone"] },
        { chunks: [chunk({ path: "step-1/a.md" })] }
      );
      client.search.mockRejectedValueOnce(new MiyoRequestError(404, "Folder not registered: Gone"));

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).toHaveBeenCalledTimes(2);
      expect(client.search).toHaveBeenLastCalledWith(BASE_URL, "step-1", "q", 1000, {
        variants: [],
        folderNames: ["step-1", "Research"],
      });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toMatchObject({
        count: 1,
        note: 'Miyo has no folder "Gone" ticked in Copilot settings, so it was not searched.',
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/734 returns no notes when the skipped-folder note alone overflows the budget", async () => {
      const missing = Array.from({ length: 40 }, (_, i) => `${i}-${"x".repeat(1_000)}`);
      const { client, deps } = setup({ miyoExtraSearchFolders: missing });
      for (const name of missing) {
        client.search.mockRejectedValueOnce(
          new MiyoRequestError(404, `Folder not registered: ${name}`)
        );
      }

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toMatchObject({ results: [], count: 0 });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 reports an error without widening when the vault itself is missing from Miyo", async () => {
      const { client, deps } = setup({ miyoExtraSearchFolders: ["Research"] });
      client.search.mockRejectedValue(new MiyoRequestError(404, "Folder not registered: step-1"));

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("Folder not registered: step-1");
    });

    it("searches every Miyo folder in Unrestricted scope, ignoring the vault and the ticked folders", async () => {
      const { client, deps } = setup({
        miyoSearchAll: true,
        miyoExtraSearchFolders: ["Research"],
      });

      await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).toHaveBeenCalledWith(BASE_URL, undefined, "q", 1000, {
        variants: [],
        folderNames: undefined,
      });
    });

    it("searches the configured remote Miyo URL", async () => {
      const { client, deps } = setup({
        miyoConnectionMode: "remote",
        miyoServerUrl: " https://miyo.example.com/base ",
      });
      client.resolveBaseUrl.mockResolvedValue("https://miyo.example.com/base");

      await runMiyoSearch({ query: "q" }, deps);

      expect(client.resolveBaseUrl).toHaveBeenCalledWith("https://miyo.example.com/base");
      expect(client.search).toHaveBeenCalledWith(
        "https://miyo.example.com/base",
        "step-1",
        "q",
        1000,
        expect.any(Object)
      );
    });

    it("passes up to two variants through and drops the rest", async () => {
      const { client, deps } = setup();

      await runMiyoSearch({ query: "q", variants: ["one", "two", "three"] }, deps);

      expect(client.search).toHaveBeenCalledWith(
        BASE_URL,
        "step-1",
        "q",
        1000,
        expect.objectContaining({ variants: ["one", "two"] })
      );
    });

    it("ignores variants that are not an array of strings", async () => {
      const { client, deps } = setup();

      await runMiyoSearch({ query: "q", variants: "one" }, deps);
      await runMiyoSearch({ query: "q", variants: ["one", 2, null] }, deps);

      expect(client.search).toHaveBeenNthCalledWith(
        1,
        BASE_URL,
        "step-1",
        "q",
        1000,
        expect.objectContaining({ variants: [] })
      );
      expect(client.search).toHaveBeenNthCalledWith(
        2,
        BASE_URL,
        "step-1",
        "q",
        1000,
        expect.objectContaining({ variants: ["one"] })
      );
    });

    it.each([[undefined], [null], [{}], [{ query: "" }], [{ query: "   " }], [{ query: 5 }]])(
      "returns an error and searches nothing when the arguments are %j",
      async (args) => {
        const { client, deps } = setup();

        const result = await runMiyoSearch(args, deps);

        expect(client.search).not.toHaveBeenCalled();
        expect(result).toEqual({ text: "query must be a non-empty string.", isError: true });
      }
    );

    it("tells the agent to continue with keyword search and ask the user to open Miyo when Miyo is unreachable", async () => {
      const { client, deps } = setup();
      client.resolveBaseUrl.mockRejectedValue(new Error("Miyo base URL not available"));

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Continue with keyword search");
      expect(result.text).toContain("tell the user to open Miyo");
      expect(result.text).toContain("Miyo base URL not available");
    });

    it("gives the same instruction when the search request itself fails", async () => {
      const { client, deps } = setup();
      client.search.mockRejectedValue(new MiyoRequestError(503, "Embedding service is not ready"));

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Continue with keyword search");
      expect(result.text).toContain("Embedding service is not ready");
    });
  });
});
