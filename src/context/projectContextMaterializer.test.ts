import { FileSystemAdapter, TFolder, type App } from "obsidian";
import type { ContextCacheFs } from "./contextCacheFs";

// In-memory fs injected in place of the node cache fs.
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
import { getMatchingPatterns } from "@/search/searchUtils";
import {
  ensureProjectContextMaterialized,
  materializeProjectContextSource,
  type ContextMaterializeProgress,
} from "./projectContextMaterializer";

const getRecord = getCachedProjectRecordById as jest.Mock;
const getPatterns = getMatchingPatterns as jest.Mock;
const getClient = BrevilabsClient.getInstance as jest.Mock;

const CWD = "/vault/Proj";
// Cache writes go to the SHARED off-vault cache now (node-fs backed, mocked here
// by the in-memory `mockFs`). The store receives cache-root-relative dirs
// derived by the materializer: `remotes/`, `files/`, and a per-project
// `markers/<md5(projectId)>/`. The agent-facing absolute folder/note paths still
// come from `getFullPath` and are asserted as `/vault/...` below — unchanged.

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
      getAbstractFileByPath: (p: string) => (folderSet.has(p) ? new Folder(p) : null),
      readBinary: jest.fn(async () => new ArrayBuffer(4)),
    },
  } as unknown as App;
}

beforeEach(() => {
  mockFs = memFs();
  jest.clearAllMocks();
  getPatterns.mockReturnValue(patterns());
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
    expect(result.projectContextBlock).toBeUndefined();
  });

  it("returns empty when the project has no context sources", async () => {
    getRecord.mockReturnValue(record({}));
    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
    expect(result.additionalDirectories).toEqual([]);
    expect(result.projectContextBlock).toBeUndefined();
    expect(mockFs.files.size).toBe(0);
  });

  it("materializes a web URL into the shared remotes dir and inlines it in the context block", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://example.com" }));
    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);

    expect(result.projectContextBlock).toContain("<project_context>");
    expect(result.projectContextBlock).toContain("https://example.com");
    // No manifest file is written anywhere — context is inline in the prompt.
    expect([...mockFs.files.keys()].some((k) => k.endsWith("CONTEXT.md"))).toBe(false);
    // The snapshot lands under the shared `remotes/` dir, not a project dir.
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
    // Both folders are listed in the block with absolute paths (add-dir is only
    // for the out-of-cwd one).
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

  it("materializes in-vault PDFs but ignores markdown files", async () => {
    getRecord.mockReturnValue(record({ inclusions: "Proj" }));
    getPatterns.mockReturnValue(patterns({ folderPatterns: ["Proj"] }));
    const app = fakeApp([
      { path: "Proj/a.pdf", ext: "pdf" },
      { path: "Proj/note.md", ext: "md" },
    ]);

    await ensureProjectContextMaterialized(app, "p1", CWD);

    const client = getClient.mock.results[0].value as { docs4llm: jest.Mock };
    expect(client.docs4llm).toHaveBeenCalledTimes(1); // pdf only, never the .md
    expect([...mockFs.files.keys()].some((k) => k.includes("/file-"))).toBe(true);
  });

  it("reports resolve + per-loop progress through onProgress", async () => {
    getRecord.mockReturnValue(record({ inclusions: "Proj", webUrls: "https://example.com" }));
    getPatterns.mockReturnValue(patterns({ folderPatterns: ["Proj"] }));
    const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }]);

    const progress: ContextMaterializeProgress[] = [];
    await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

    // Resolve fires first, counting the one materialize-eligible binary file.
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
    // Degrades gracefully: block still built, no snapshot written, never throws.
    expect(result.projectContextBlock).toContain("https://broken.com");
    expect([...mockFs.files.keys()].some((k) => k.startsWith("remotes/web-"))).toBe(false);
    // No manifest file is written.
    expect([...mockFs.files.keys()].some((k) => k.endsWith("CONTEXT.md"))).toBe(false);
  });

  it("returns the frozen empty result if a filesystem write throws", async () => {
    getRecord.mockReturnValue(record({ webUrls: "https://example.com" }));
    // mkdir is awaited outside the per-source try/catch, so a hard fs failure
    // propagates to the never-reject guard and degrades to the empty result.
    mockFs.mkdirRecursive = jest.fn(async () => {
      throw new Error("EACCES");
    });

    const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
    expect(result.additionalDirectories).toEqual([]);
    expect(result.projectContextBlock).toBeUndefined();
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
    expect(client.url4llm).toHaveBeenCalledTimes(1); // fetched once, not twice
    expect(r1).toBe(r2); // both awaited the same in-flight promise
  });

  it("does not serialize different projects with DIFFERENT sources", async () => {
    // Distinct URLs per project: the per-project single-flight doesn't block them
    // and they don't collide on the global per-artifact lock (different keys).
    getRecord.mockImplementation((id: string) =>
      record({ webUrls: id === "p1" ? "https://p1.com" : "https://p2.com" }, id)
    );

    await Promise.all([
      ensureProjectContextMaterialized(fakeApp(), "p1", "/vault/P1"),
      ensureProjectContextMaterialized(fakeApp(), "p2", "/vault/P2"),
    ]);

    const client = getClient.mock.results[0].value as { url4llm: jest.Mock };
    expect(client.url4llm).toHaveBeenCalledTimes(2); // one per project, ran in parallel
  });

  it("dedupes two projects converting the SAME url to a single fetch (global per-artifact lock)", async () => {
    // Same URL across two distinct projects → same snapshot file name → same
    // global mutex. The first fetches and writes; the second re-reads the meta
    // inside the lock and cheap-skips. (The OLD behavior fetched twice.)
    getRecord.mockImplementation((id: string) => record({ webUrls: "https://shared.com" }, id));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const url4llm = jest.fn(async () => {
      calls += 1;
      await gate; // hold the lock so the second project is forced to wait
      return { response: `content #${calls}` };
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const a = ensureProjectContextMaterialized(fakeApp(), "pA", "/vault/PA");
    await flushMicrotasks(); // A acquires the lock and reaches the gated fetch
    const b = ensureProjectContextMaterialized(fakeApp(), "pB", "/vault/PB");
    await flushMicrotasks(); // B is waiting on the same per-artifact lock
    release();
    await Promise.all([a, b]);

    expect(url4llm).toHaveBeenCalledTimes(1); // merged to a single fetch
    const snapshots = [...mockFs.files.keys()].filter((k) => k.startsWith("remotes/web-"));
    expect(snapshots).toHaveLength(1);
    expect(mockFs.files.get(snapshots[0])).toContain("content #1"); // not overwritten by B
  });

  it("clears the in-flight entry so a later call re-evaluates fresh state", async () => {
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    await ensureProjectContextMaterialized(app, "p1", CWD);

    // After the first run settled, the source changed — a fresh call must run
    // again (not return the prior settled promise) and fetch the new URL.
    getRecord.mockReturnValue(record({ webUrls: "https://b.com" }));
    await ensureProjectContextMaterialized(app, "p1", CWD);

    const client = getClient.mock.results[0].value as { url4llm: jest.Mock };
    expect(client.url4llm).toHaveBeenCalledWith("https://b.com");
    expect(client.url4llm).toHaveBeenCalledTimes(2);
  });

  it("supersedes an in-flight run whose source set was edited (a later caller must not join the stale run)", async () => {
    const app = fakeApp();
    // Run A materializes source A; gate its fetch so it stays in flight.
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const url4llm = jest.fn(async (url: string) => {
      if (url === "https://a.com") await gate; // hold run A in flight
      return { response: url === "https://a.com" ? "A text" : "B text" };
    });
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const a = ensureProjectContextMaterialized(app, "p1", CWD); // non-force, signature S1
    await flushMicrotasks(); // A reaches the gated fetch, still in flight

    // The project's context is edited mid-flight → new source set → new signature.
    getRecord.mockReturnValue(record({ webUrls: "https://b.com" }));
    const b = ensureProjectContextMaterialized(app, "p1", CWD); // non-force, signature S2

    release(); // let A settle; B's deferred run then materializes the NEW source
    const [aRes, bRes] = await Promise.all([a, b]);

    // B did NOT join the stale run — it superseded and captured the edited sources.
    // (Pre-fix, the unconditional non-force join returned A's pre-edit result and
    // never fetched b.com.)
    expect(bRes).not.toBe(aRes);
    expect(url4llm).toHaveBeenCalledWith("https://b.com");
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

    // Second automatic pass: the failure marker is honored — the URL is not
    // re-fetched — yet the failure is still surfaced through onProgress.
    const progress: ContextMaterializeProgress[] = [];
    await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

    expect(url4llm).toHaveBeenCalledTimes(1); // not re-fetched
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

    // The single-source Retry forces a fresh fetch even though the marker is on
    // disk (the automatic path above would have cheap-skipped it).
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

    // Phase 1: source A fails on the automatic path → marker, no snapshot.
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

    // Phase 2: the source set now also has B (e.g. a source edit kicked off a
    // warm). The warm is non-force, so it cheap-skips A's marker and only fetches
    // B; a forced "Retry" arrives while it is in flight.
    getRecord.mockReturnValue(record({ webUrls: "https://a.com\nhttps://b.com" }));
    const url4llm = jest.fn(async (url: string) => ({ response: url === "https://a.com" ? "A recovered" : "B text" })); // prettier-ignore
    getClient.mockReturnValue({ url4llm, youtube4llm: jest.fn(), docs4llm: jest.fn() });

    const warm = ensureProjectContextMaterialized(app, "p1", CWD); // non-force
    const forced = ensureProjectContextMaterialized(app, "p1", CWD, undefined, true);
    const joiner = ensureProjectContextMaterialized(app, "p1", CWD); // non-force, lands after the force

    // Resolved-value identity (the fn is async, so promise refs always differ):
    // a later non-force caller joins the FORCED run, not the stale warm — so a
    // session-create / landing-refresh after Retry captures the forced result.
    const [warmRes, forcedRes, joinerRes] = await Promise.all([warm, forced, joiner]);
    expect(joinerRes).toBe(forcedRes);
    expect(joinerRes).not.toBe(warmRes);

    // The forced pass re-fetched A past its marker and cleared it (a non-force
    // warm would have cheap-skipped it); B (written by the warm) cheap-skipped on
    // its identity fingerprint.
    expect(url4llm).toHaveBeenCalledWith("https://a.com");
    const snapshotA = [...mockFs.files.keys()].find(
      (k) => k.includes("/web-") && mockFs.files.get(k)!.includes("A recovered")
    );
    expect(snapshotA).toBeDefined();
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(false);
  });

  it("a concurrent full run does not duplicate or clobber a single-source retry (per-artifact lock)", async () => {
    // Replaces the old reconcile-coordination test. Shared snapshots are never
    // reconciled, and the retry + full run serialize on the per-artifact lock for
    // the same URL — so the retry's snapshot survives and is not re-fetched.
    const app = fakeApp();
    getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));

    // 1. First automatic run fails → marker on disk, no snapshot.
    getClient.mockReturnValue({
      url4llm: jest.fn(async () => {
        throw new Error("down");
      }),
      youtube4llm: jest.fn(),
      docs4llm: jest.fn(),
    });
    await ensureProjectContextMaterialized(app, "p1", CWD);
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(true);

    // 2. Gate the single-source retry's fetch so it holds the per-artifact lock.
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
    await flushMicrotasks(); // the retry acquires the lock and reaches its gated fetch

    // 3. A full run starts during the retry's write window. Its upsert for the
    //    same URL waits on the same per-artifact lock rather than re-fetching.
    const full = ensureProjectContextMaterialized(app, "p1", CWD);
    await flushMicrotasks();

    // 4. Release the retry; both settle.
    releaseFetch();
    await Promise.all([retry, full]);

    // 5. One fetch total (the retry's); its snapshot survived, marker cleared.
    const snapshot = [...mockFs.files.keys()].find((k) => k.startsWith("remotes/web-"));
    expect(snapshot).toBeDefined();
    expect(mockFs.files.get(snapshot!)).toContain("recovered");
    expect([...mockFs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(false);
    expect(url4llm).toHaveBeenCalledTimes(1);
  });
});
