import type { ProjectConfig } from "@/aiParams";
import {
  updateCachedProjectRecords,
  useActiveProjects,
  useArchivedProjects,
  useProjects,
} from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import { act, renderHook } from "@testing-library/react";

function record(id: string, archivedAt?: number): ProjectFileRecord {
  const project: ProjectConfig = {
    id,
    name: id,
    systemPrompt: "",
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    archivedAt,
  };
  return { project, filePath: `projects/${id}/project.md`, folderName: id };
}

describe("state", () => {
  beforeEach(() => {
    act(() => updateCachedProjectRecords([]));
  });

  describe("useActiveProjects()", () => {
    it("lists the projects that are not archived, leaving out archived ones", () => {
      act(() => updateCachedProjectRecords([record("a"), record("b", 5_000), record("c")]));

      const { result } = renderHook(() => useActiveProjects());

      expect(result.current.map((project) => project.id)).toEqual(["a", "c"]);
    });

    it("returns the same empty array while nothing is active", () => {
      act(() => updateCachedProjectRecords([record("a", 5_000)]));
      const { result } = renderHook(() => useActiveProjects());
      const first = result.current;

      act(() => updateCachedProjectRecords([record("a", 5_000), record("b", 6_000)]));

      expect(result.current).toEqual([]);
      expect(result.current).toBe(first);
    });
  });

  describe("useArchivedProjects()", () => {
    it("lists only archived projects and follows an unarchive", () => {
      act(() => updateCachedProjectRecords([record("a"), record("b", 5_000)]));
      const { result } = renderHook(() => useArchivedProjects());
      expect(result.current.map((project) => project.id)).toEqual(["b"]);

      act(() => updateCachedProjectRecords([record("a"), record("b")]));

      expect(result.current).toEqual([]);
    });
  });

  describe("useProjects()", () => {
    it("lists archived and active projects together", () => {
      act(() => updateCachedProjectRecords([record("a"), record("b", 5_000)]));

      const { result } = renderHook(() => useProjects());

      expect(result.current.map((project) => project.id)).toEqual(["a", "b"]);
    });
  });
});
