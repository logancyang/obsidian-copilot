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
const URL_B = "https://b.example.com/x";

const webSource: AgentProcessingSource = { kind: "web", source: URL_A };
const youtubeSource: AgentProcessingSource = { kind: "youtube", source: "https://youtu.be/x" };

function entry(over: Partial<AgentProjectContextLoadState> = {}): AgentProjectContextLoadState {
  return { phase: "done", blocking: false, ...over };
}

function disk(over: Partial<AgentCacheDirState> = {}): AgentCacheDirState {
  return {
    snapshotNames: new Set(),
    markersByName: new Map(),
    ...over,
  };
}

const SAVED_ALL = new Set([`web:${URL_A}`, `youtube:${youtubeSource.source}`]);

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

function snapshotBody(sourceType: string): string {
  const meta = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceType,
    sourceUrl: "https://x",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: "web:x",
  };
  return `<!-- copilot-context-cache\n${JSON.stringify(meta)}\n-->\n\nbody\n`;
}

function markerBody(source: string, kind: string, error: string): string {
  return JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    source,
    kind,
    error,
    failedAt: 1,
  });
}

describe("agentProcessingAdapter", () => {
  describe("buildAgentProcessingSources()", () => {
    it("lists each URL source with its type", () => {
      const sources = buildAgentProcessingSources([
        { id: "1", url: URL_A, type: "web" },
        { id: "2", url: "https://youtu.be/x", type: "youtube" },
      ]);

      expect(sources).toEqual([
        { kind: "web", source: URL_A },
        { kind: "youtube", source: "https://youtu.be/x" },
      ]);
    });
  });

  describe("buildAgentProcessingItems()", () => {
    it("marks sources Queued when there is no live entry and no disk state", () => {
      const items = buildAgentProcessingItems(
        [webSource, youtubeSource],
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

    it("shows in-flight sources (processingSources) as Converting and queues the rest", () => {
      const live = entry({
        phase: "prefetch",
        prefetch: { done: 0, total: 2 },
        processingSources: [{ kind: "web", source: URL_A }],
      });
      const [web, youtube] = buildAgentProcessingItems(
        [webSource, youtubeSource],
        live,
        disk(),
        SAVED_ALL
      );
      expect(web.status).toBe("processing");
      expect(youtube.status).toBe("pending");
    });

    it("never shows an unsaved draft as processing, even when a run is in flight", () => {
      const live = entry({ phase: "prefetch", prefetch: { done: 0, total: 1 } });
      const savedOnlyYoutube = new Set([`youtube:${youtubeSource.source}`]);
      const [web] = buildAgentProcessingItems([webSource], live, disk(), savedOnlyYoutube);
      expect(web.status).toBe("pending");
    });

    it("shows all parallel-fetched URLs as Converting together", () => {
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
  });

  describe("aggregateAgentCacheDirState()", () => {
    const webName = cacheFileName("web", URL_A);
    const webMarker = failureMarkerName("web", URL_A);

    it("collects snapshots from the remotes dir and reads markers from the marker dir", async () => {
      const state = await aggregateAgentCacheDirState({
        remotes: fakeReader({ [webName]: snapshotBody("web") }),
        markers: fakeReader({ [webMarker]: markerBody(URL_A, "web", "fetch 404") }),
      });

      expect(state.snapshotNames.has(webName)).toBe(true);
      expect(state.markersByName.get(webMarker)?.error).toBe("fetch 404");
    });

    it("does not read remote snapshot bodies (identity-fingerprinted)", async () => {
      let remoteReads = 0;
      const remotes: AgentCacheDirReader = {
        list: async () => [webName],
        readText: async () => {
          remoteReads++;
          return snapshotBody("web");
        },
      };
      const state = await aggregateAgentCacheDirState({ remotes, markers: fakeReader({}) });
      expect(state.snapshotNames.has(webName)).toBe(true);
      expect(remoteReads).toBe(0);
    });

    it("degrades to empty sets when a directory is missing/unreadable", async () => {
      const state = await aggregateAgentCacheDirState({
        remotes: throwingReader,
        markers: throwingReader,
      });
      expect(state.snapshotNames.size).toBe(0);
      expect(state.markersByName.size).toBe(0);
    });

    it("skips unparseable marker bodies and non-marker files in the marker dir", async () => {
      const state = await aggregateAgentCacheDirState({
        remotes: fakeReader({}),
        markers: fakeReader({ [webMarker]: "{not json", "stray.txt": "ignored" }),
      });
      expect(state.markersByName.size).toBe(0);
    });
  });
});
