import { FileSystemAdapter, TFolder, type App } from "obsidian";
import type { ContextCacheFs } from "./contextCacheFs";

let mockFs: ContextCacheFs & { files: Map<string, string> };

jest.mock("./contextCacheFs", () => ({
  createNodeContextCacheFs: () => mockFs,
}));

jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: jest.fn(),
}));
jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(),
  shouldIndexFile: jest.fn(() => true),
}));
jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: { getInstance: jest.fn() },
}));

import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { getCachedProjectRecordById } from "@/projects/state";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import {
  ensureProjectContextMaterialized,
  materializeProjectContextSource,
  type ContextMaterializeProgress,
} from "./projectContextMaterializer";

const getRecord = getCachedProjectRecordById as jest.Mock;
const getPatterns = getMatchingPatterns as jest.Mock;
const indexFile = shouldIndexFile as jest.Mock;
const getClient = BrevilabsClient.getInstance as jest.Mock;

const CWD = "/vault/Proj";

function memFs(): ContextCacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p) => files.has(p),
    mkdirRecursive: async () => undefined,
    list: async (dir) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((n) => !n.includes("/"));
    },
    readText: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    writeText: async (p, c) => void files.set(p, c),
    remove: async (p) => void files.delete(p),
  };
}

function record(contextSource: Record<string, string | undefined>, id = "p1") {
  return { project: { id, contextSource }, filePath: "Proj/AGENTS.md", folderName: "Proj" };
}

const flushMicrotasks = () => new Promise((resolve) => window.setTimeout(resolve, 0));

function patterns(over: Record<string, string[]> = {}) {
  return {
    inclusions: { folderPatterns: [], notePatterns: [], extensionPatterns: [], tagPatterns: [], ...over }, // prettier-ignore
    exclusions: null,
  };
}

function fakeApp(files: Array<{ path: string; ext: string }> = [], folders: string[] = []): App {
  const tfiles = files.map((f) => ({
    path: f.path,
    extension: f.ext,
    basename: f.path
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, ""),
    stat: { mtime: 1000, size: 10 },
  }));
  const folderSet = new Set(folders);
  const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
  const Folder = TFolder as unknown as new (path: string) => TFolder;
  return {
    vault: {
      adapter: new FsAdapter("/vault"),
      getFiles: () => tfiles,
      getMarkdownFiles: () => tfiles.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) => (folderSet.has(p) ? new Folder(p) : null),
      readBinary: jest.fn(async () => new ArrayBuffer(4)),
    },
  } as unknown as App;
}

beforeEach(() => {
  mockFs = memFs();
  jest.clearAllMocks();
  getPatterns.mockReturnValue(patterns());
  indexFile.mockReturnValue(true);
  getClient.mockReturnValue({
    url4llm: jest.fn(async () => ({ response: "url text" })),
    youtube4llm: jest.fn(async () => ({ response: { transcript: "yt text" } })),
    docs4llm: jest.fn(async () => ({ response: "pdf text" })),
  });
});

describe("ensureProjectContextMaterialized", () => {
  it("returns the frozen empty result when the project is unknown", async () => {
    getRecord.mockReturnValue(undefined);
    const result = await ensureProjectContextMaterialized(fakeApp(), "missing", CWD);
    expect(result.additionalDirectories).toEqual([]);
    expect(result.projectContextBlock).toContain("project workspace");
    expect(result.contextSignature).toBeUndefined();
  });

  it("still emits a minimal project block when the project has no context sources", async () => {
    getRecord.mockReturnValue(record({}));
    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
    expect(result.additionalDirectories).toEqual([]);
    expect(result.projectContextBlock).toContain("<project_context>");
    expect(result.projectContextBlock).toContain("No context sources are configured");
    expect(mockFs.files.size).toBe(0);
  });

  it("materializes a web URL into the shared remotes dir and inlines it in the context block", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://example.com" }));
    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);

    expect(result.projectContextBlock).toContain("<project_context>");
    expect(result.projectContextBlock).toContain("https://example.com");
    expect([...mockFs.files.keys()].some((k) => k.endsWith("CONTEXT.md"))).toBe(false);
    const cacheFile = [...mockFs.files.keys()].find((k) => k.startsWith("remotes/web-"));
    expect(cacheFile).toBeDefined();
    expect(mockFs.files.get(cacheFile!)).toContain("url text");
  });

  it("reports only out-of-cwd folder inclusions as additional directories", async () => {
    getRecord.mockReturnValue(record({ inclusions: "External,Proj/Sub" }));
    getPatterns.mockReturnValue(patterns({ folderPatterns: ["External", "Proj/Sub"] }));
    const app = fakeApp([], ["External", "Proj/Sub"]);

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    expect(result.additionalDirectories).toEqual(["/vault/External"]);
    expect(result.projectContextBlock).toContain("`/vault/External`");
    expect(result.projectContextBlock).toContain("`/vault/Proj/Sub`");
  });

  it("lists included notes by absolute path in the context block", async () => {
    getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
    getPatterns.mockReturnValue(patterns({ notePatterns: ["[[Spec]]"] }));
    const app = fakeApp([{ path: "Notes/Spec.md", ext: "md" }]);

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    expect(result.projectContextBlock).toContain("## Included notes");
    expect(result.projectContextBlock).toContain("`/vault/Notes/Spec.md`");
  });

  it("lists every note that shares an inclusion title (basename collision)", async () => {
    getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
    getPatterns.mockReturnValue(patterns({ notePatterns: ["[[Spec]]"] }));
    const app = fakeApp([
      { path: "A/Spec.md", ext: "md" },
      { path: "B/Spec.md", ext: "md" },
    ]);

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    expect(result.projectContextBlock).toContain("`/vault/A/Spec.md`");
    expect(result.projectContextBlock).toContain("`/vault/B/Spec.md`");
  });

  it("counts a property-only inclusion as a source and enumerates matching notes by absolute path", async () => {
    getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
    getPatterns.mockReturnValue(patterns({ propertyPatterns: ["[Topics:Physics]"] }));
    const app = fakeApp([
      { path: "Notes/Relativity.md", ext: "md" },
      { path: "Notes/Cooking.md", ext: "md" },
    ]);
    indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path === "Notes/Relativity.md"); // prettier-ignore

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    expect(result.projectContextBlock).toContain("<project_context>");
    expect(result.projectContextBlock).toContain("## Notes matching an included property");
    expect(result.projectContextBlock).toContain("`/vault/Notes/Relativity.md`");
    expect(result.projectContextBlock).not.toContain("Cooking");
  });

  it("lists a note reached by both a title and a property once, as a declaration", async () => {
    getRecord.mockReturnValue(record({ inclusions: "[[Relativity]],[Topics:Physics]" }));
    getPatterns.mockReturnValue(
      patterns({ notePatterns: ["[[Relativity]]"], propertyPatterns: ["[Topics:Physics]"] })
    );
    const app = fakeApp([{ path: "Notes/Relativity.md", ext: "md" }]);
    indexFile.mockReturnValue(true);

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    const block = result.projectContextBlock ?? "";
    expect(block.match(/\/vault\/Notes\/Relativity\.md/g)).toHaveLength(1);
    expect(block).toContain("## Included notes");
    expect(block).not.toContain("## Notes matching an included property");
  });

  it("still emits <project_context> for a property-only project when no note currently matches", async () => {
    getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
    getPatterns.mockReturnValue(patterns({ propertyPatterns: ["[Topics:Physics]"] }));
    const app = fakeApp([{ path: "Notes/Cooking.md", ext: "md" }]);
    indexFile.mockReturnValue(false);

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    expect(result.projectContextBlock).toContain("<project_context>");
    expect(result.projectContextBlock).not.toContain("## Included notes");
  });

  it("lists a note matched by BOTH a note inclusion and a property only once", async () => {
    getRecord.mockReturnValue(record({ inclusions: "[[Relativity]],[Topics:Physics]" }));
    getPatterns.mockReturnValue(
      patterns({ notePatterns: ["[[Relativity]]"], propertyPatterns: ["[Topics:Physics]"] })
    );
    const app = fakeApp([{ path: "Notes/Relativity.md", ext: "md" }]);
    indexFile.mockReturnValue(true);

    const result = await ensureProjectContextMaterialized(app, "p1", CWD);

    const block = result.projectContextBlock ?? "";
    const occurrences = block.split("`/vault/Notes/Relativity.md`").length - 1;
    expect(occurrences).toBe(1);
  });

  it("materializes in-vault PDFs but ignores markdown files", async () => {
    getRecord.mockReturnValue(record({ inclusions: "Proj" }));
    getPatterns.mockReturnValue(patterns({ folderPatterns: ["Proj"] }));
    const app = fakeApp([
      { path: "Proj/a.pdf", ext: "pdf" },
      { path: "Proj/note.md", ext: "md" },
    ]);

    await ensureProjectContextMaterialized(app, "p1", CWD);

    const client = getClient.mock.results[0].value as { docs4llm: jest.Mock };
    expect(client.docs4llm).toHaveBeenCalledTimes(1);
    expect([...mockFs.files.keys()].some((k) => k.includes("/file-"))).toBe(true);
  });

  it("reports resolve + per-loop progress through onProgress", async () => {
    getRecord.mockReturnValue(record({ inclusions: "Proj", webUrls: "https://example.com" }));
    getPatterns.mockReturnValue(patterns({ folderPatterns: ["Proj"] }));
    const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }]);

    const progress: ContextMaterializeProgress[] = [];
    await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

    expect(progress[0]).toEqual({ phase: "resolve", resolved: 1 });
    expect(progress).toContainEqual({ phase: "prefetch", done: 1, total: 1 });
    expect(progress).toContainEqual({ phase: "parse", done: 1, total: 1 });
  });

  it("never rejects when a brevilabs fetch fails", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://broken.com" }));
    getClient.mockReturnValue({
      url4llm: jest.fn(async () => {
        throw new Error("network down");
      }),
      youtube4llm: jest.fn(),
      docs4llm: jest.fn(),
    });

    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
    expect(result.projectContextBlock).toContain("https://broken.com");
    expect([...mockFs.files.keys()].some((k) => k.startsWith("remotes/web-"))).toBe(false);
    expect([...mockFs.files.keys()].some((k) => k.endsWith("CONTEXT.md"))).toBe(false);
  });

  it("returns the frozen empty result if a filesystem write throws", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://example.com" }));
    mockFs.mkdirRecursive = jest.fn(async () => {
      throw new Error("EACCES");
    });

    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
    expect(result.additionalDirectories).toEqual([]);
    expect(result.projectContextBlock).toContain("project workspace");
    expect(result.projectContextBlock).toContain("could not be loaded");
    expect(result.contextSignature).toBeUndefined();
  });
});

describe("ensureProjectContextMaterialized — single-flight", () => {
  it("dedupes concurrent calls for the same project to one run", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    const app = fakeApp();

    const [r1, r2] = await Promise.all([
      ensureProjectContextMaterialized(app, "p1", CWD),
      ensureProjectContextMaterialized(app, "p1", CWD),
    ]);

    const client = getClient.mock.results[0].value as { url4llm: jest.Mock };
    expect(client.url4llm).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });

  it("does not serialize different projects with DIFFERENT sources", async () => {
    getRecord.mockImplementation((id: string) =>
      record({ webUrls: id === "p1" ? "https://p1.com" : "https://p2.com" }, id)
    );

    await Promise.all([
      ensureProjectContextMaterialized(fakeApp(), "p1", "/vault/P1"),
      ensureProjectContextMaterialized(fakeApp(), "p2", "/vault/P2"),
    ]);

    const client = getClient.mock.results[0].value as { url4llm: jest.Mock };
    expect(client.url4llm).toHaveBeenCalledTimes(2);
  });

  it("dedupes two projects converting the SAME url to a single fetch (global per-artifact lock)", async () => {
    getRecord.mockImplementation((id: string) => record({ webUrls: "https://shared.com" }, id));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const url4llm = jest.fn(async () => {
      calls += 1;
      await gate;
      return { response: `content #${calls}` };
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const a = ensureProjectContextMaterialized(fakeApp(), "pA", "/vault/PA");
    await flushMicrotasks();
    const b = ensureProjectContextMaterialized(fakeApp(), "pB", "/vault/PB");
    await flushMicrotasks();
    release();
    await Promise.all([a, b]);

    expect(url4llm).toHaveBeenCalledTimes(1);
    const snapshots = [...mockFs.files.keys()].filter((k) => k.startsWith("remotes/web-"));
    expect(snapshots).toHaveLength(1);
    expect(mockFs.files.get(snapshots[0])).toContain("content #1");
  });

  it("clears the in-flight entry so a later call re-evaluates fresh state", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    await ensureProjectContextMaterialized(app, "p1", CWD);

    getRecord.mockReturnValue(record({ webUrls: "https://b.com" }));
    await ensureProjectContextMaterialized(app, "p1", CWD);

    const client = getClient.mock.results[0].value as { url4llm: jest.Mock };
    expect(client.url4llm).toHaveBeenCalledWith("https://b.com");
    expect(client.url4llm).toHaveBeenCalledTimes(2);
  });

  it("supersedes an in-flight run whose source set was edited (a later caller must not join the stale run)", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const url4llm = jest.fn(async (url: string) => {
      if (url === "https://a.com") await gate;
      return { response: url === "https://a.com" ? "A text" : "B text" };
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const a = ensureProjectContextMaterialized(app, "p1", CWD);
    await flushMicrotasks();

    getRecord.mockReturnValue(record({ webUrls: "https://b.com" }));
    const b = ensureProjectContextMaterialized(app, "p1", CWD);

    release();
    const [aRes, bRes] = await Promise.all([a, b]);

    expect(bRes).not.toBe(aRes);
    expect(url4llm).toHaveBeenCalledWith("https://b.com");
  });

  it("supersedes an in-flight run when a caller passes a NEWER revisionKey (same config signature)", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const url4llm = jest.fn(async (url: string) => {
      await gate;
      return { response: `${url} text` };
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const a = ensureProjectContextMaterialized(app, "p1", CWD, undefined, undefined, "sig#0");
    await flushMicrotasks();
    const b = ensureProjectContextMaterialized(app, "p1", CWD, undefined, undefined, "sig#1");

    release();
    const [aRes, bRes] = await Promise.all([a, b]);

    expect(bRes).not.toBe(aRes);
  });

  it("still dedupes concurrent callers that share the same revisionKey", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    const app = fakeApp();

    const [r1, r2] = await Promise.all([
      ensureProjectContextMaterialized(app, "p1", CWD, undefined, undefined, "sig#7"),
      ensureProjectContextMaterialized(app, "p1", CWD, undefined, undefined, "sig#7"),
    ]);

    const client = getClient.mock.results[0].value as { url4llm: jest.Mock };
    expect(client.url4llm).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
  });
});

describe("Option D — failure markers, forced retry, single-source reconcile", () => {
  it("cheap-skips a known-bad source on the next automatic run (no re-fetch)", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    const url4llm = jest.fn(async () => {
      throw new Error("network down");
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    await ensureProjectContextMaterialized(app, "p1", CWD);
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(true);

    const progress: ContextMaterializeProgress[] = [];
    await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

    expect(url4llm).toHaveBeenCalledTimes(1);
    const failures = progress.find((p) => p.phase === "failures");
    expect(failures?.phase === "failures" && failures.failures).toHaveLength(1);
  });

  it("materializeProjectContextSource forces a retry past the failure marker", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    const url4llm = jest.fn(async (): Promise<{ response: string }> => {
      throw new Error("network down");
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });
    await ensureProjectContextMaterialized(app, "p1", CWD);
    expect(url4llm).toHaveBeenCalledTimes(1);

    url4llm.mockResolvedValueOnce({ response: "recovered" });
    const failures = await materializeProjectContextSource(app, "p1", {
      kind: "web",
      source: "https://a.com",
    });

    expect(url4llm).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(0);
    const snapshot = [...mockFs.files.keys()].find((k) => k.includes("/web-"));
    expect(mockFs.files.get(snapshot!)).toContain("recovered");
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(false);
  });

  it("a forced retry supersedes an in-flight non-force warm; later joiners get the forced result", async () => {
    const app = fakeApp();

    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    getClient.mockReturnValue({
      url4llm: jest.fn(async () => {
        throw new Error("down");
      }),
      youtube4llm: jest.fn(),
      docs4llm: jest.fn(),
    });
    await ensureProjectContextMaterialized(app, "p1", CWD);
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(true);

    getRecord.mockReturnValue(record({ webUrls: "https://a.com\nhttps://b.com" }));
    const url4llm = jest.fn(async (url: string) => ({ response: url === "https://a.com" ? "A recovered" : "B text" })); // prettier-ignore
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const warm = ensureProjectContextMaterialized(app, "p1", CWD);
    const forced = ensureProjectContextMaterialized(app, "p1", CWD, undefined, true);
    const joiner = ensureProjectContextMaterialized(app, "p1", CWD);

    const [warmRes, forcedRes, joinerRes] = await Promise.all([warm, forced, joiner]);
    expect(joinerRes).toBe(forcedRes);
    expect(joinerRes).not.toBe(warmRes);

    expect(url4llm).toHaveBeenCalledWith("https://a.com");
    const snapshotA = [...mockFs.files.keys()].find(
      (k) => k.includes("/web-") && mockFs.files.get(k)!.includes("A recovered")
    );
    expect(snapshotA).toBeDefined();
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(false);
  });

  it("a concurrent full run does not duplicate or clobber a single-source retry (per-artifact lock)", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));

    getClient.mockReturnValue({
      url4llm: jest.fn(async () => {
        throw new Error("down");
      }),
      youtube4llm: jest.fn(),
      docs4llm: jest.fn(),
    });
    await ensureProjectContextMaterialized(app, "p1", CWD);
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(true);

    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const url4llm = jest.fn(async () => {
      await gate;
      return { response: "recovered" };
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const retry = materializeProjectContextSource(app, "p1", { kind: "web", source: "https://a.com" }); // prettier-ignore
    await flushMicrotasks();

    const full = ensureProjectContextMaterialized(app, "p1", CWD);
    await flushMicrotasks();

    releaseFetch();
    await Promise.all([retry, full]);

    const snapshot = [...mockFs.files.keys()].find((k) => k.startsWith("remotes/web-"));
    expect(snapshot).toBeDefined();
    expect(mockFs.files.get(snapshot!)).toContain("recovered");
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(false);
    expect(url4llm).toHaveBeenCalledTimes(1);
  });
});
