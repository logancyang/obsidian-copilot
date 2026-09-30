import { mockTFile } from "@/__tests__/mockObsidian";
import type { AgentProjectContextLoadState } from "@/aiParams";
import {
  aggregateAgentCacheDirState,
  buildAgentProcessingItems,
  buildAgentProcessingSources,
  type AgentCacheDirReader,
  type AgentCacheDirState,
  type AgentProcessingSource,
} from "@/components/project/agentProcessingAdapter";
import {
  CACHE_SCHEMA_VERSION,
  cacheFileName,
  failureMarkerName,
} from "@/context/contextCacheStore";

const URL_A = "https://a.example.com/page";
const PDF = "docs/spec.pdf";

const webSource: AgentProcessingSource = { kind: "web", source: URL_A };
const fileSource: AgentProcessingSource = { kind: "file", source: PDF, fingerprint: "100:5" };

function entry(over: Partial<AgentProjectContextLoadState> = {}): AgentProjectContextLoadState {
  return { phase: "done", blocking: false, ...over };
}

function disk(over: Partial<AgentCacheDirState> = {}): AgentCacheDirState {
  return {
    snapshotNames: new Set(),
    markersByName: new Map(),
    fingerprintsByName: new Map(),
    ...over,
  };
}

const SAVED_ALL = new Set([`web:${URL_A}`, `file:${PDF}`]);

function fakeReader(files: Record<string, string>): AgentCacheDirReader {
  return {
    list: async () => Object.keys(files),
    readText: async (name) => {
      if (!(name in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files[name];
    },
  };
}

const throwingReader: AgentCacheDirReader = {
  list: async () => {
    throw new Error("ENOENT: no such directory");
  },
  readText: async () => {
    throw new Error("ENOENT");
  },
};

function snapshotBody(over: {
  sourceType: string;
  fingerprint: string;
  sourcePath?: string;
}): string {
  const meta = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceType: over.sourceType,
    ...(over.sourcePath ? { sourcePath: over.sourcePath } : { sourceUrl: "https://x" }),
    fetchedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: over.fingerprint,
  };
  return `<!-- copilot-context-cache\n${JSON.stringify(meta)}\n-->\n\nbody\n`;
}

function markerBody(source: string, kind: string, error: string, fingerprint?: string): string {
  return JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    source,
    kind,
    error,
    failedAt: 1,
    ...(fingerprint !== undefined ? { fingerprint } : {}),
  });
}

describe("agentProcessingAdapter", () => {
  describe("buildAgentProcessingSources()", () => {
    it("lists URL sources by type, then file sources fingerprinted by mtime and size", () => {
      const sources = buildAgentProcessingSources(
        [
          { id: "1", url: URL_A, type: "web" },
          { id: "2", url: "https://youtu.be/x", type: "youtube" },
        ],
        [mockTFile({ path: PDF, stat: { ctime: 0, mtime: 100, size: 5 } })]
      );

      expect(sources).toEqual([
        { kind: "web", source: URL_A },
        { kind: "youtube", source: "https://youtu.be/x" },
        { kind: "file", source: PDF, fingerprint: "100:5" },
      ]);
    });
  });

  describe("buildAgentProcessingItems()", () => {
    it("marks sources Queued when there is no live entry and no disk state", () => {
      const items = buildAgentProcessingItems(
        [webSource, fileSource],
        undefined,
        undefined,
        SAVED_ALL
      );
      expect(items.map((i) => i.status)).toEqual(["pending", "pending"]);
    });

    it("marks a source Converted when its disk snapshot exists", () => {
      const d = disk({ snapshotNames: new Set([cacheFileName("web", URL_A)]) });
      const [web] = buildAgentProcessingItems([webSource], undefined, d, SAVED_ALL);
      expect(web.status).toBe("ready");
    });

    it("downgrades a file snapshot to Queued when the file changed since conversion", () => {
      const name = cacheFileName("file", PDF);
      const d = disk({
        snapshotNames: new Set([name]),
        fingerprintsByName: new Map([[name, "100:5"]]),
      });
      const fresh = buildAgentProcessingItems([fileSource], undefined, d, SAVED_ALL)[0];
      expect(fresh.status).toBe("ready");

      const changed = buildAgentProcessingItems(
        [{ ...fileSource, fingerprint: "200:9" }],
        undefined,
        d,
        SAVED_ALL
      )[0];
      expect(changed.status).toBe("pending");
    });

    it("keeps a file snapshot Queued when its fingerprint is unknown (unreadable/old meta)", () => {
      const d = disk({ snapshotNames: new Set([cacheFileName("file", PDF)]) });
      const [file] = buildAgentProcessingItems([fileSource], undefined, d, SAVED_ALL);
      expect(file.status).toBe("pending");
    });

    it("marks a source Failed with the persisted error when a disk failure marker exists", () => {
      const d = disk({
        markersByName: new Map([
          [
            failureMarkerName("web", URL_A),
            { schemaVersion: CACHE_SCHEMA_VERSION, source: URL_A, kind: "web" as const, error: "fetch 404", failedAt: 1 }, // prettier-ignore
          ],
        ]),
      });
      const [web] = buildAgentProcessingItems([webSource], undefined, d, SAVED_ALL);
      expect(web.status).toBe("failed");
      expect(web.error).toBe("fetch 404");
    });

    it("prefers a live missing failure over a stale disk snapshot", () => {
      const d = disk({ snapshotNames: new Set([cacheFileName("web", URL_A)]) });
      const live = entry({
        failedSources: [{ path: URL_A, type: "web", error: "boom", usedStaleSnapshot: false }],
      });
      const [web] = buildAgentProcessingItems([webSource], live, d, SAVED_ALL);
      expect(web.status).toBe("failed");
      expect(web.error).toBe("boom");
    });

    it("treats a live stale-but-usable failure as Converted even without disk state", () => {
      const live = entry({
        failedSources: [{ path: URL_A, type: "web", error: "net down", usedStaleSnapshot: true }],
      });
      const [web] = buildAgentProcessingItems([webSource], live, undefined, SAVED_ALL);
      expect(web.status).toBe("ready");
    });

    it("matches live nonMd failures to file sources", () => {
      const live = entry({
        failedSources: [{ path: PDF, type: "nonMd", error: "parse", usedStaleSnapshot: false }],
      });
      const [file] = buildAgentProcessingItems([fileSource], live, undefined, SAVED_ALL);
      expect(file.status).toBe("failed");
    });

    it("shows in-flight sources (processingSources) as Converting and queues the rest", () => {
      const live = entry({
        phase: "prefetch",
        prefetch: { done: 0, total: 2 },
        processingSources: [{ kind: "web", source: URL_A }],
      });
      const [web, file] = buildAgentProcessingItems(
        [webSource, fileSource],
        live,
        disk(),
        SAVED_ALL
      );
      expect(web.status).toBe("processing");
      expect(file.status).toBe("pending");
    });

    it("never shows an unsaved draft as processing, even when a run is in flight", () => {
      const live = entry({ phase: "prefetch", prefetch: { done: 0, total: 1 } });
      const savedOnlyFile = new Set([`file:${PDF}`]);
      const [web] = buildAgentProcessingItems([webSource], live, disk(), savedOnlyFile);
      expect(web.status).toBe("pending");
    });

    it("shows all parallel-fetched URLs as Converting together", () => {
      const URL_B = "https://b.example.com/x";
      const live = entry({
        phase: "prefetch",
        prefetch: { done: 0, total: 2 },
        processingSources: [
          { kind: "web", source: URL_A },
          { kind: "web", source: URL_B },
        ],
      });
      const items = buildAgentProcessingItems(
        [webSource, { kind: "web", source: URL_B }],
        live,
        disk(),
        new Set([`web:${URL_A}`, `web:${URL_B}`])
      );
      expect(items.map((i) => i.status)).toEqual(["processing", "processing"]);
    });

    it("shows a saved failure marker as Failed during a run and Converting only once it is retried", () => {
      const d = disk({
        markersByName: new Map([
          [
            failureMarkerName("web", URL_A),
            { schemaVersion: CACHE_SCHEMA_VERSION, source: URL_A, kind: "web" as const, error: "fetch 404", failedAt: 1 }, // prettier-ignore
          ],
        ]),
      });
      const duringRun = entry({ phase: "prefetch", prefetch: { done: 0, total: 1 } });
      const [failed] = buildAgentProcessingItems([webSource], duringRun, d, SAVED_ALL);
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("fetch 404");

      const active = entry({
        phase: "prefetch",
        prefetch: { done: 0, total: 1 },
        processingSources: [{ kind: "web", source: URL_A }],
      });
      const [web] = buildAgentProcessingItems([webSource], active, d, SAVED_ALL);
      expect(web.status).toBe("processing");
      expect(web.error).toBeUndefined();

      const retrying = entry({ phase: "done", retryingSources: [{ kind: "web", source: URL_A }] });
      expect(buildAgentProcessingItems([webSource], retrying, d, SAVED_ALL)[0].status).toBe("processing"); // prettier-ignore
    });

    it("honors a file failure marker only while its fingerprint matches (changed/legacy → re-attempt)", () => {
      const markerName = failureMarkerName("file", PDF);
      const withMarker = (fingerprint?: string) =>
        disk({
          markersByName: new Map([
            [
              markerName,
              {
                schemaVersion: CACHE_SCHEMA_VERSION,
                source: PDF,
                kind: "file" as const,
                error: "parse boom",
                failedAt: 1,
                ...(fingerprint !== undefined ? { fingerprint } : {}),
              },
            ],
          ]),
        });
      const duringRun = entry({ phase: "parse", parsed: { done: 0, total: 1 } });

      const matched = buildAgentProcessingItems([fileSource], duringRun, withMarker("100:5"), SAVED_ALL)[0]; // prettier-ignore
      expect(matched.status).toBe("failed");
      expect(matched.error).toBe("parse boom");

      expect(buildAgentProcessingItems([fileSource], duringRun, withMarker("999:9"), SAVED_ALL)[0].status).toBe("pending"); // prettier-ignore

      expect(buildAgentProcessingItems([fileSource], duringRun, withMarker(undefined), SAVED_ALL)[0].status).toBe("pending"); // prettier-ignore
    });

    it("shows a stale file snapshot as Converting only while it's in processingSources", () => {
      const name = cacheFileName("file", PDF);
      const d = disk({
        snapshotNames: new Set([name]),
        fingerprintsByName: new Map([[name, "100:5"]]),
      });
      const changed = { ...fileSource, fingerprint: "200:9" };
      const queued = entry({ phase: "parse", parsed: { done: 0, total: 1 } });
      expect(buildAgentProcessingItems([changed], queued, d, SAVED_ALL)[0].status).toBe("pending");
      const active = entry({
        phase: "parse",
        parsed: { done: 0, total: 1 },
        processingSources: [{ kind: "file", source: PDF }],
      });
      expect(buildAgentProcessingItems([changed], active, d, SAVED_ALL)[0].status).toBe(
        "processing"
      );
    });

    it("distinguishes a same-URL web and youtube pair by cacheKind (matches the CAG id contract)", () => {
      const dual: AgentProcessingSource[] = [
        { kind: "web", source: URL_A },
        { kind: "youtube", source: URL_A },
      ];
      const items = buildAgentProcessingItems(dual, undefined, undefined, new Set());
      expect(items.map((i) => i.id)).toEqual([URL_A, URL_A]);
      expect(items[0].cacheKind).toBe("web");
      expect(items[1].cacheKind).toBe("youtube");
    });

    it("maps kinds onto the panel's source/fileType model", () => {
      const items = buildAgentProcessingItems(
        [webSource, fileSource],
        undefined,
        undefined,
        SAVED_ALL
      );
      expect(items[0]).toMatchObject({ source: "url", fileType: "web", cacheKind: "web" });
      expect(items[1]).toMatchObject({ source: "file", fileType: "pdf", cacheKind: "file" });
    });
  });

  describe("aggregateAgentCacheDirState()", () => {
    const webName = cacheFileName("web", URL_A);
    const fileName = cacheFileName("file", PDF);
    const fileMarker = failureMarkerName("file", PDF);

    it("unions snapshots from remotes + files and reads markers from the marker dir", async () => {
      const state = await aggregateAgentCacheDirState(
        {
          remotes: fakeReader({
            [webName]: snapshotBody({ sourceType: "web", fingerprint: "web:x" }),
          }),
          files: fakeReader({
            [fileName]: snapshotBody({ sourceType: "file", sourcePath: PDF, fingerprint: "100:5" }),
          }),
          markers: fakeReader({ [fileMarker]: markerBody(PDF, "file", "parse boom", "100:5") }),
        },
        new Set([fileName])
      );

      expect(state.snapshotNames.has(webName)).toBe(true);
      expect(state.snapshotNames.has(fileName)).toBe(true);
      expect(state.fingerprintsByName.get(fileName)).toBe("100:5");
      expect(state.markersByName.get(fileMarker)?.error).toBe("parse boom");
    });

    it("does not read remote snapshot bodies (identity-fingerprinted)", async () => {
      let remoteReads = 0;
      const remotes: AgentCacheDirReader = {
        list: async () => [webName],
        readText: async () => {
          remoteReads++;
          return snapshotBody({ sourceType: "web", fingerprint: "web:x" });
        },
      };
      const state = await aggregateAgentCacheDirState(
        { remotes, files: fakeReader({}), markers: fakeReader({}) },
        new Set([webName])
      );
      expect(state.snapshotNames.has(webName)).toBe(true);
      expect(remoteReads).toBe(0);
    });

    it("degrades to empty sets when a directory is missing/unreadable", async () => {
      const state = await aggregateAgentCacheDirState(
        { remotes: throwingReader, files: throwingReader, markers: throwingReader },
        new Set()
      );
      expect(state.snapshotNames.size).toBe(0);
      expect(state.markersByName.size).toBe(0);
      expect(state.fingerprintsByName.size).toBe(0);
    });

    it("skips unparseable marker bodies and non-marker files in the marker dir", async () => {
      const state = await aggregateAgentCacheDirState(
        {
          remotes: fakeReader({}),
          files: fakeReader({}),
          markers: fakeReader({
            [fileMarker]: "{not json",
            "stray.txt": "ignored",
          }),
        },
        new Set()
      );
      expect(state.markersByName.size).toBe(0);
    });
  });
});
