import { DEFAULT_SETTINGS } from "@/constants";
import { setSettings } from "@/settings/model";
import { App } from "obsidian";

// Mock ChatModelManager to avoid importing Anthropic SDK in tests
jest.mock("@/LLMProviders/chatModelManager", () => {
  return {
    __esModule: true,
    default: {
      getInstance: jest.fn().mockReturnValue({
        countTokens: jest.fn().mockResolvedValue(100),
      }),
    },
  };
});

import { MemoryIndexManager } from "./MemoryIndexManager";

jest.mock("@/LLMProviders/embeddingManager", () => {
  class FakeEmbeddingsAPI {
    async embedQuery(q: string): Promise<number[]> {
      if (q.toLowerCase().includes("alpha")) return [1, 0];
      if (q.toLowerCase().includes("beta")) return [0, 1];
      return [0.5, 0.5];
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      // Deterministic dummy vectors, not used in these tests
      return texts.map((t, i) => [i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 1]);
    }
  }
  return {
    __esModule: true,
    default: {
      getInstance: () => ({
        getEmbeddingsAPI: async () => new FakeEmbeddingsAPI(),
      }),
    },
  };
});

function makeApp(opts: {
  exists: boolean;
  content?: string;
  captureWrites?: { buffer: string[] };
}): App {
  return {
    vault: {
      configDir: "/mock/config",
      adapter: {
        exists: async (_path: string) => opts.exists,
        read: async (_path: string) => opts.content || "",
        write: async (_path: string, data: string) => {
          opts.captureWrites?.buffer.push(data);
        },
        remove: async (_path: string) => {},
        mkdir: async (_path: string) => {},
      },
      getMarkdownFiles: () => [] as any,
      cachedRead: async () => "",
      getAbstractFileByPath: (_: string) => ({}) as any,
    } as any,
    metadataCache: {
      getFileCache: () => ({}) as any,
    } as any,
    workspace: {
      getActiveFile: () => null,
    } as any,
  } as any;
}

describe("MemoryIndexManager", () => {
  beforeEach(() => {
    // Ensure logger has a valid settings object
    setSettings({ ...DEFAULT_SETTINGS, debug: false });
    // Reset singleton between tests
    MemoryIndexManager.__resetForTests();
  });

  test("loadIfExists returns false when file missing", async () => {
    const app = makeApp({ exists: false });
    const manager = MemoryIndexManager.getInstance(app);
    const loaded = await manager.loadIfExists();
    expect(loaded).toBe(false);
    expect(manager.isAvailable()).toBe(false);
  });

  test("loadIfExists builds vector store and search returns expected results", async () => {
    const jsonl = [
      JSON.stringify({
        id: "a#0",
        path: "a.md",
        title: "Alpha note",
        mtime: 0,
        ctime: 0,
        embedding: [1, 0],
      }),
      JSON.stringify({
        id: "b#0",
        path: "b.md",
        title: "Beta note",
        mtime: 0,
        ctime: 0,
        embedding: [0, 1],
      }),
    ].join("\n");

    const app = makeApp({ exists: true, content: jsonl });
    const manager = MemoryIndexManager.getInstance(app);
    const loaded = await manager.loadIfExists();
    expect(loaded).toBe(true);
    expect(manager.isAvailable()).toBe(true);

    const resultsAlpha = await manager.search(["alpha"], 5);
    expect(resultsAlpha.length).toBeGreaterThan(0);
    expect(resultsAlpha[0].id).toBe("a#0");
    // After chunk-level aggregation + min-max scaling, score should be near 1 and others below
    expect(resultsAlpha[0].score).toBeGreaterThan(0.5);

    const resultsBetaOnlyCandidate = await manager.search(["alpha"], 5, ["b.md"]);
    // Candidate filter should ensure only b.md chunks are considered
    expect(resultsBetaOnlyCandidate.every((r) => r.id.startsWith("b#"))).toBe(true);
  });

  test("indexVault writes JSONL lines", async () => {
    const writes: string[] = [];
    const app = makeApp({ exists: false, captureWrites: { buffer: writes } });
    // Mock simple vault files
    (app.vault.getMarkdownFiles as any) = () => [
      {
        path: "x.md",
        basename: "x",
        stat: { mtime: Date.now(), ctime: Date.now() },
        extension: "md",
      },
    ];
    (app.vault.cachedRead as any) = async () => "# Title\n\nBody";
    const manager = MemoryIndexManager.getInstance(app);
    const count = await manager.indexVault();
    expect(count).toBeGreaterThan(0);
    expect(writes.join("\n")).toContain("x.md");
  });

  test("reindexSingleFileIfModified updates only that file", async () => {
    const writes: string[] = [];
    // Existing index has a.md with one chunk
    const existing = JSON.stringify({
      id: "a.md#0",
      path: "a.md",
      title: "Alpha",
      mtime: 1,
      ctime: 1,
      embedding: [1, 0],
    });
    const app = makeApp({ exists: true, content: existing, captureWrites: { buffer: writes } });
    const manager = MemoryIndexManager.getInstance(app);
    await manager.loadIfExists();

    // Mock reading content and embeddings
    (app.vault.cachedRead as any) = async () => "# Title\n\nBody";
    const file: any = {
      path: "a.md",
      basename: "a",
      extension: "md",
      stat: { mtime: 2, ctime: 1 },
    };

    await manager.reindexSingleFileIfModified(file, 1);
    // Should have written partitions and not thrown
    expect(writes.length).toBeGreaterThan(0);
    const joined = writes.join("\n");
    expect(joined).toContain("a.md");
  });
});
