import type { AgentProjectContextLoadState } from "@/aiParams";
import {
  aggregateAgentCacheDirState,
  buildAgentProcessingItems,
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

describe("buildAgentProcessingItems", () => {
  it("is Queued with no live entry, no disk state", () => {
    const items = buildAgentProcessingItems(
      [webSource, fileSource],
      undefined,
      undefined,
      SAVED_ALL
    );
    expect(items.map((i) => i.status)).toEqual(["pending", "pending"]);
  });

  it("is Converted when the disk snapshot exists", () => {
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
    // Snapshot file present but no stored fingerprint → can't prove it's current.
    const d = disk({ snapshotNames: new Set([cacheFileName("file", PDF)]) });
    const [file] = buildAgentProcessingItems([fileSource], undefined, d, SAVED_ALL);
    expect(file.status).toBe("pending");
  });

  it("is Failed with the persisted error when a disk failure marker exists", () => {
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
    // Mid-run: the URL is actively fetching (in processingSources) → processing;
    // the file hasn't started yet → Queued. Both are saved.
    const live = entry({
      phase: "prefetch",
      prefetch: { done: 0, total: 2 },
      processingSources: [{ kind: "web", source: URL_A }],
    });
    const [web, file] = buildAgentProcessingItems([webSource, fileSource], live, disk(), SAVED_ALL);
    expect(web.status).toBe("processing");
    expect(file.status).toBe("pending"); // queued: hasn't started this run
  });

  it("never shows an unsaved draft as processing, even when a run is in flight", () => {
    const live = entry({ phase: "prefetch", prefetch: { done: 0, total: 1 } });
    const savedOnlyFile = new Set([`file:${PDF}`]);
    const [web] = buildAgentProcessingItems([webSource], live, disk(), savedOnlyFile);
    expect(web.status).toBe("pending"); // draft-only URL: no run knows about it
  });

  it("shows all parallel-fetched URLs as Converting together", () => {
    // URLs fetch in parallel, so processingSources holds them all at once.
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

  it("shows a saved failure marker as Failed during a run (Option D skips it), Converting only when retried", () => {
    // Option D cheap-skips a known-bad source on the automatic run, so a valid
    // marker reads as failed even mid-run — never Queued (nothing re-fetches it
    // until a manual Retry). It flips to Converting only when the user forces a
    // retry and the source enters processingSources.
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

    // The per-row "Retry" path drives `retryingSources` (not processingSources);
    // it too must override the marker so the row spins immediately on click.
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

    // fileSource's live fingerprint is "100:5".
    // Marker fingerprint matches → cheap-skipped → failed, even mid-run.
    const matched = buildAgentProcessingItems([fileSource], duringRun, withMarker("100:5"), SAVED_ALL)[0]; // prettier-ignore
    expect(matched.status).toBe("failed");
    expect(matched.error).toBe("parse boom");

    // File changed since the failure (fingerprint mismatch) → marker not honored,
    // the run re-attempts it → Queued, not a stale failure.
    expect(buildAgentProcessingItems([fileSource], duringRun, withMarker("999:9"), SAVED_ALL)[0].status).toBe("pending"); // prettier-ignore

    // Legacy marker without a fingerprint → untrustworthy → re-attempted, not failed.
    expect(buildAgentProcessingItems([fileSource], duringRun, withMarker(undefined), SAVED_ALL)[0].status).toBe("pending"); // prettier-ignore
  });

  it("shows a stale file snapshot as Converting only while it's in processingSources", () => {
    const name = cacheFileName("file", PDF);
    const d = disk({
      snapshotNames: new Set([name]),
      fingerprintsByName: new Map([[name, "100:5"]]),
    });
    const changed = { ...fileSource, fingerprint: "200:9" };
    // Run active, file not yet re-parsed → Queued.
    const queued = entry({ phase: "parse", parsed: { done: 0, total: 1 } });
    expect(buildAgentProcessingItems([changed], queued, d, SAVED_ALL)[0].status).toBe("pending");
    // Being re-parsed → processing.
    const active = entry({
      phase: "parse",
      parsed: { done: 0, total: 1 },
      processingSources: [{ kind: "file", source: PDF }],
    });
    expect(buildAgentProcessingItems([changed], active, d, SAVED_ALL)[0].status).toBe("processing");
  });

  it("distinguishes a same-URL web and youtube pair by cacheKind (matches the CAG id contract)", () => {
    // `id` is the raw URL (CAG parity → clean display + remove-by-(cacheKind,url)).
    // The two rows are still distinct items; cacheKind is what tells them apart.
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

/** In-memory {@link AgentCacheDirReader} over a name→content map (missing → throws). */
function fakeReader(files: Record<string, string>): AgentCacheDirReader {
  return {
    list: async () => Object.keys(files),
    readText: async (name) => {
      if (!(name in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files[name];
    },
  };
}

/** A throwing reader, modeling a missing/unreadable directory. */
const throwingReader: AgentCacheDirReader = {
  list: async () => {
    throw new Error("ENOENT: no such directory");
  },
  readText: async () => {
    throw new Error("ENOENT");
  },
};

/** A valid snapshot file body with the leading meta block parseSnapshotMeta reads. */
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

describe("aggregateAgentCacheDirState (off-vault dual-source)", () => {
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

    // Snapshots come from BOTH buckets.
    expect(state.snapshotNames.has(webName)).toBe(true);
    expect(state.snapshotNames.has(fileName)).toBe(true);
    // File fingerprint read only for the requested name.
    expect(state.fingerprintsByName.get(fileName)).toBe("100:5");
    // Marker parsed from the per-project marker dir.
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
      // Even if the URL snapshot name is "requested", remotes are never body-read.
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
          [fileMarker]: "{not json", // malformed → skipped
          "stray.txt": "ignored", // not a failed-*.json → skipped
        }),
      },
      new Set()
    );
    expect(state.markersByName.size).toBe(0);
  });
});
