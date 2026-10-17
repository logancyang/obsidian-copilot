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
  });

  describe("runMiyoSearch()", () => {
    it("searches only the active vault in Current vault scope and returns the CLI's result shape", async () => {
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

      expect(client.search).toHaveBeenCalledWith(BASE_URL, "step-1", "hiking trip", 10, {
        variants: [],
        folderNames: undefined,
      });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({
        results: [
          {
            path: "step-1/notes/Trip planning.md",
            content: "NOTE BLOCK CONTENT:\nbody of step-1/notes/Trip planning.md",
          },
          {
            path: "step-1/notes/Sourdough starter.md",
            content: "NOTE BLOCK CONTENT:\nbody of step-1/notes/Sourdough starter.md",
          },
        ],
        count: 2,
      });
    });

    it("returns an empty result list when Miyo finds nothing", async () => {
      const { deps } = setup();

      const result = await runMiyoSearch({ query: "nothing here" }, deps);

      expect(result).toEqual({ text: '{"results":[],"count":0}', isError: false });
    });

    it("merges one file's chunks in note order and keeps files in Miyo's ranking", async () => {
      const { deps } = setup(
        {},
        {
          chunks: [
            chunk({ path: "step-1/b.md", chunk_index: 0, chunk_text: "only" }),
            chunk({ path: "step-1/a.md", chunk_index: 1, chunk_text: "second" }),
            chunk({ path: "step-1/a.md", chunk_index: 0, chunk_text: "first" }),
          ],
        }
      );

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(JSON.parse(result.text).results).toEqual([
        { path: "step-1/b.md", content: "NOTE BLOCK CONTENT:\nonly" },
        {
          path: "step-1/a.md",
          content: "NOTE BLOCK CONTENT:\nfirst\n\nNOTE BLOCK CONTENT:\nsecond",
        },
      ]);
    });

    it("widens Current vault scope with the extra Miyo folders ticked in settings, leaving out the vault itself", async () => {
      const { client, deps } = setup({ miyoExtraSearchFolders: ["Research", "step-1", "ChatGPT"] });

      await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).toHaveBeenCalledWith(BASE_URL, "step-1", "q", 10, {
        variants: [],
        folderNames: ["step-1", "Research", "ChatGPT"],
      });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3508 retries with the vault alone and says so when a ticked folder is missing from Miyo", async () => {
      const { client, deps } = setup(
        { miyoExtraSearchFolders: ["Research", "Gone"] },
        { chunks: [chunk({ path: "step-1/a.md" })] }
      );
      client.search.mockRejectedValueOnce(new MiyoRequestError(404, "Folder not registered: Gone"));

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).toHaveBeenCalledTimes(2);
      expect(client.search).toHaveBeenLastCalledWith(BASE_URL, "step-1", "q", 10, {
        variants: [],
        folderNames: undefined,
      });
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toMatchObject({
        count: 1,
        note: 'Miyo has no folder "Gone" that is ticked in Copilot settings, so only the active vault was searched.',
      });
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

      expect(client.search).toHaveBeenCalledWith(BASE_URL, undefined, "q", 10, {
        variants: [],
        folderNames: undefined,
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 returns an error and searches nothing when Current vault scope has no vault identity", async () => {
      const { client, deps } = setup({}, { vaultName: "" });

      const result = await runMiyoSearch({ query: "q" }, deps);

      expect(client.search).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.text).toContain("active vault identity is missing");
      expect(result.text).toContain("Do not retry or run an unrestricted search");
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
        10,
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
        10,
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
        10,
        expect.objectContaining({ variants: [] })
      );
      expect(client.search).toHaveBeenNthCalledWith(
        2,
        BASE_URL,
        "step-1",
        "q",
        10,
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
