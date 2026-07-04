import type { AgentProjectContextLoadState, ProjectConfig } from "@/aiParams";
import * as adapter from "@/components/project/agentProcessingAdapter";
import { useAgentPersistentFailureCount } from "@/components/project/useAgentPersistentFailureCount";
import {
  CACHE_SCHEMA_VERSION,
  cacheFileName,
  failureMarkerName,
} from "@/context/contextCacheStore";
import { listMaterializeCandidates } from "@/context/materializeCandidates";
import * as projectState from "@/projects/state";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { App } from "obsidian";

jest.mock("@/context/materializeCandidates", () => ({
  listMaterializeCandidates: jest.fn(() => []),
}));

const readSpy = jest.spyOn(adapter, "readAgentCacheDirState");
const listCandidatesMock = listMaterializeCandidates as jest.MockedFunction<
  typeof listMaterializeCandidates
>;
jest
  .spyOn(projectState, "getCachedProjectRecordById")
  .mockReturnValue({ filePath: "Projects/p1/project.md" } as never);

const app = { vault: { adapter: {} } } as unknown as App;
const project = {
  id: "p1",
  contextSource: { webUrls: "https://a.com", youtubeUrls: "" },
} as unknown as ProjectConfig;

function entry(over: Partial<AgentProjectContextLoadState> = {}): AgentProjectContextLoadState {
  return { phase: "done", blocking: false, ...over };
}

const webMarkerDisk = {
  snapshotNames: new Set<string>(),
  markersByName: new Map([
    [
      failureMarkerName("web", "https://a.com"),
      { schemaVersion: CACHE_SCHEMA_VERSION, source: "https://a.com", kind: "web" as const, error: "boom", failedAt: 1 }, // prettier-ignore
    ],
  ]),
  fingerprintsByName: new Map<string, string>(),
};

describe("useAgentPersistentFailureCount", () => {
  beforeEach(() => {
    readSpy.mockReset();
    // The module mock factory returns [] by default, but mockReset() above would
    // clear it for any test that overrides it — restore the no-file-sources default.
    listCandidatesMock.mockReset();
    listCandidatesMock.mockReturnValue([]);
  });

  it("does not read disk while a run is in flight (live atom is authoritative)", () => {
    readSpy.mockResolvedValue(webMarkerDisk);
    const running = entry({ phase: "prefetch" });
    const { result } = renderHook(() =>
      useAgentPersistentFailureCount(app, project, running, true)
    );
    expect(result.current).toBe(0);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("does not read disk while a retry is in flight even at phase done", () => {
    readSpy.mockResolvedValue(webMarkerDisk);
    const retrying = entry({ retryingSources: [{ kind: "web", source: "https://a.com" }] });
    renderHook(() => useAgentPersistentFailureCount(app, project, retrying, true));
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("counts a persisted failure marker once settled", async () => {
    readSpy.mockResolvedValue(webMarkerDisk);
    const settled = entry();
    const { result } = renderHook(() =>
      useAgentPersistentFailureCount(app, project, settled, true)
    );
    await waitFor(() => expect(result.current).toBe(1));
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it("does not count a stale file marker when a SHARED snapshot is fresh", async () => {
    // Regression (shared off-vault cache): project A's parse failed and left a
    // marker whose fingerprint still matches the unchanged file; project B then
    // wrote the shared snapshot. The resting icon must read the file snapshot's
    // fingerprint and let that fresh shared snapshot override A's stale marker —
    // counting 0, not a phantom failure. (With the old EMPTY set it read 1.)
    const filePath = "Docs/source.pdf";
    const fingerprint = "10:20";
    const snapshotName = cacheFileName("file", filePath);
    listCandidatesMock.mockReturnValue([
      { path: filePath, extension: "pdf", stat: { mtime: 10, size: 20 } } as never,
    ]);
    readSpy.mockResolvedValue({
      snapshotNames: new Set([snapshotName]),
      markersByName: new Map([
        [
          failureMarkerName("file", filePath),
          { schemaVersion: CACHE_SCHEMA_VERSION, source: filePath, kind: "file" as const, error: "stale parse failure", failedAt: 1, fingerprint }, // prettier-ignore
        ],
      ]),
      fingerprintsByName: new Map([[snapshotName, fingerprint]]),
    });

    const fileProject = {
      id: "p1",
      contextSource: { webUrls: "", youtubeUrls: "" },
    } as unknown as ProjectConfig;
    const { result } = renderHook(() =>
      useAgentPersistentFailureCount(app, fileProject, entry(), true)
    );

    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(1));
    // The fix: the hook now asks the reader for THIS file's snapshot fingerprint.
    expect(readSpy.mock.calls[0][2]).toEqual(new Set([snapshotName]));
    expect(result.current).toBe(0);
  });

  it("does not surface a slow read's count after the live entry changed under it", async () => {
    // staleness guard: a disk read in flight for entry A must not paint its count
    // once the hook re-renders with a different liveEntry (B) whose own read is
    // still pending — the count is keyed to the entry it was computed for.
    let resolveA!: (d: typeof webMarkerDisk) => void;
    const readA = new Promise<typeof webMarkerDisk>((r) => (resolveA = r));
    const readB = new Promise<typeof webMarkerDisk>(() => {}); // entryB's read never settles
    readSpy.mockReturnValueOnce(readA).mockReturnValueOnce(readB);

    const entryA = entry();
    const { result, rerender } = renderHook(
      ({ e }) => useAgentPersistentFailureCount(app, project, e, true),
      { initialProps: { e: entryA } }
    );

    const entryB = entry();
    rerender({ e: entryB }); // now keyed to entryB; entryB's read (readB) is pending
    await act(async () => {
      resolveA(webMarkerDisk); // the stale entryA read resolves late
    });
    // entryA's count is discarded (keyed to a now-stale entry); entryB's read is
    // still pending, so nothing is surfaced.
    expect(result.current).toBe(0);
  });

  it("invalidates an already-painted count the instant the live entry changes", async () => {
    // Directly covers the return-value freshness guard (cached count is keyed to
    // the liveEntry it was computed for): entryA paints count=1, then a rerender
    // to entryB (whose own read is still pending) must drop back to 0 immediately
    // — not keep showing entryA's stale 1.
    readSpy.mockResolvedValueOnce(webMarkerDisk); // entryA read → count 1
    const readB = new Promise<typeof webMarkerDisk>(() => {}); // entryB read pending
    const entryA = entry();
    const { result, rerender } = renderHook(
      ({ e }) => useAgentPersistentFailureCount(app, project, e, true),
      { initialProps: { e: entryA } }
    );
    await waitFor(() => expect(result.current).toBe(1));

    readSpy.mockReturnValueOnce(readB);
    const entryB = entry();
    rerender({ e: entryB });
    // entryA's cached count no longer matches the current entry → 0 at once.
    expect(result.current).toBe(0);
  });
});
