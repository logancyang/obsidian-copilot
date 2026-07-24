import type CopilotPlugin from "@/main";
import { mockTFile } from "@/__tests__/mockObsidian";
import type { TFile } from "obsidian";
import { createPiToolContext } from "./piToolContext";

const webSearch = jest.fn();
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: { getInstance: () => ({ webSearch }) },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

interface PluginStub {
  activeFile: TFile | null;
  byPath: Record<string, unknown>;
  contents: Record<string, string>;
  searchDocs: Array<{ content: string; metadata: Record<string, unknown> }>;
}

function pluginWith(stub: Partial<PluginStub> = {}): CopilotPlugin {
  const { activeFile = null, byPath = {}, contents = {}, searchDocs = [] } = stub;
  return {
    app: {
      workspace: { getActiveFile: () => activeFile },
      vault: {
        getAbstractFileByPath: (path: string) => byPath[path] ?? null,
        cachedRead: async (file: TFile) => contents[file.path] ?? "",
      },
    },
    customSearchDB: jest.fn(async () => searchDocs),
  } as unknown as CopilotPlugin;
}

describe("piToolContext", () => {
  describe("createPiToolContext()", () => {
    beforeEach(() => jest.clearAllMocks());

    describe("readActiveNote", () => {
      it("reads the note open in the workspace", async () => {
        const file = mockTFile({ path: "Daily/Today.md" });
        const context = createPiToolContext(
          pluginWith({ activeFile: file, contents: { "Daily/Today.md": "body" } })
        );

        await expect(context.readActiveNote()).resolves.toEqual({
          path: "Daily/Today.md",
          content: "body",
        });
      });

      it("returns null when no note is open", async () => {
        await expect(createPiToolContext(pluginWith()).readActiveNote()).resolves.toBeNull();
      });
    });

    describe("readNote", () => {
      it("reads a note by vault path", async () => {
        const file = mockTFile({ path: "Notes/A.md" });
        const context = createPiToolContext(
          pluginWith({ byPath: { "Notes/A.md": file }, contents: { "Notes/A.md": "text" } })
        );

        await expect(context.readNote("Notes/A.md")).resolves.toEqual({
          path: "Notes/A.md",
          content: "text",
        });
      });

      it("returns null for a path that is a folder or does not exist", async () => {
        const context = createPiToolContext(pluginWith({ byPath: { Folder: { children: [] } } }));

        await expect(context.readNote("Folder")).resolves.toBeNull();
        await expect(context.readNote("Nope.md")).resolves.toBeNull();
      });
    });

    describe("searchVault", () => {
      it("returns each hit's path with a bounded excerpt", async () => {
        const context = createPiToolContext(
          pluginWith({
            searchDocs: [{ content: "x".repeat(600), metadata: { path: "Big.md" } }],
          })
        );

        const [hit] = await context.searchVault("x");

        expect(hit.path).toBe("Big.md");
        expect(hit.excerpt).toHaveLength(501);
        expect(hit.excerpt.endsWith("…")).toBe(true);
      });

      it("caps how many hits reach the model", async () => {
        const context = createPiToolContext(
          pluginWith({
            searchDocs: Array.from({ length: 25 }, (_, i) => ({
              content: "c",
              metadata: { path: `N${i}.md` },
            })),
          })
        );

        await expect(context.searchVault("x")).resolves.toHaveLength(10);
      });

      it("returns the same frozen list when nothing matched", async () => {
        const context = createPiToolContext(pluginWith());

        expect(await context.searchVault("a")).toBe(await context.searchVault("b"));
      });
    });

    describe("webSearch", () => {
      it("appends the relay's sources to its answer", async () => {
        webSearch.mockResolvedValue({
          response: {
            choices: [{ message: { content: "It is sunny." } }],
            citations: ["https://example.com/a"],
          },
        });

        await expect(createPiToolContext(pluginWith()).webSearch("weather")).resolves.toBe(
          "It is sunny.\n\nSources:\nhttps://example.com/a"
        );
      });

      it("returns the bare answer when the relay cited nothing", async () => {
        webSearch.mockResolvedValue({
          response: { choices: [{ message: { content: "Answer." } }], citations: [] },
        });

        await expect(createPiToolContext(pluginWith()).webSearch("q")).resolves.toBe("Answer.");
      });
    });
  });
});
