import type { AgentProjectContextLoadState, ProjectConfig } from "@/aiParams";
import * as adapter from "@/components/project/agentProcessingAdapter";
import { useAgentPersistentFailureCount } from "@/components/project/useAgentPersistentFailureCount";
import { CACHE_SCHEMA_VERSION, failureMarkerName } from "@/context/contextCacheStore";
import * as projectState from "@/projects/state";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { App } from "obsidian";

const readSpy = jest.spyOn(adapter, "readAgentCacheDirState");
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
};

describe("useAgentPersistentFailureCount", () => {
  describe("useAgentPersistentFailureCount()", () => {
    beforeEach(() => {
      readSpy.mockReset();
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

    it("reports nothing for a project whose only sources are PDFs, even when an earlier version left a failure marker for one", async () => {
      readSpy.mockResolvedValue({
        snapshotNames: new Set<string>(),
        markersByName: new Map([
          [
            "failed-file-0123456789abcdef.json",
            { schemaVersion: CACHE_SCHEMA_VERSION, source: "Docs/source.pdf", kind: "file" as never, error: "quota exceeded", failedAt: 1 }, // prettier-ignore
          ],
        ]),
      });
      const pdfProject = {
        id: "p1",
        contextSource: { webUrls: "", youtubeUrls: "", inclusions: "Docs" },
      } as unknown as ProjectConfig;

      const { result } = renderHook(() =>
        useAgentPersistentFailureCount(app, pdfProject, entry(), true)
      );

      expect(result.current).toBe(0);
      expect(readSpy).not.toHaveBeenCalled();
    });

    it("does not surface a slow read's count after the live entry changed under it", async () => {
      let resolveA!: (d: typeof webMarkerDisk) => void;
      const readA = new Promise<typeof webMarkerDisk>((r) => (resolveA = r));
      const readB = new Promise<typeof webMarkerDisk>(() => {});
      readSpy.mockReturnValueOnce(readA).mockReturnValueOnce(readB);

      const entryA = entry();
      const { result, rerender } = renderHook(
        ({ e }) => useAgentPersistentFailureCount(app, project, e, true),
        { initialProps: { e: entryA } }
      );

      const entryB = entry();
      rerender({ e: entryB });
      await act(async () => {
        resolveA(webMarkerDisk);
      });
      expect(result.current).toBe(0);
    });

    it("invalidates an already-painted count the instant the live entry changes", async () => {
      readSpy.mockResolvedValueOnce(webMarkerDisk);
      const readB = new Promise<typeof webMarkerDisk>(() => {});
      const entryA = entry();
      const { result, rerender } = renderHook(
        ({ e }) => useAgentPersistentFailureCount(app, project, e, true),
        { initialProps: { e: entryA } }
      );
      await waitFor(() => expect(result.current).toBe(1));

      readSpy.mockReturnValueOnce(readB);
      const entryB = entry();
      rerender({ e: entryB });
      expect(result.current).toBe(0);
    });
  });
});
