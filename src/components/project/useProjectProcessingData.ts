/**
 * Shared hook for building project processing status data.
 *
 * Extracted from AddProjectModal to be reusable by both
 * AddProjectModal (with draft contextSource preview) and
 * ProgressCard (with saved project only).
 */

import { getCurrentProject, ProjectConfig, useProjectContextLoad } from "@/aiParams";
import { ContextCache, ProjectContextCache } from "@/cache/projectContextCache";
import {
  buildProcessingItems,
  type ProcessingAdapterResult,
} from "@/components/project/processingAdapter";
import { useApp } from "@/context";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { FileParserManager } from "@/tools/FileParserManager";
import { TFile } from "obsidian";
import { useEffect, useMemo, useState } from "react";

export interface UseProjectProcessingDataParams {
  /** Saved project config — used for cache lookup, isCurrentProject check, and file enumeration. */
  cacheProject: ProjectConfig | null;
  /**
   * Optional draft contextSource override for generating the items list.
   * When provided, newly added (but unsaved) URLs appear as "Pending".
   * When omitted, falls back to cacheProject.contextSource.
   */
  contextSource?: ProjectConfig["contextSource"];
}

export interface UseProjectProcessingDataResult {
  /** Full adapter result including items and failedItemMap (null while loading or no project). */
  processingData: ProcessingAdapterResult | null;
  /** Cache three-state: undefined = loading, null = no cache, ContextCache = loaded. */
  projectCache: ContextCache | null | undefined;
  /** Whether cacheProject is the currently active/loaded project. */
  isCurrentProject: boolean;
}

/**
 * Build project processing status data for ProcessingStatus rendering.
 *
 * Handles:
 * - Async cache loading (re-fetches when contextLoadState changes)
 * - Vault file enumeration from cacheProject's inclusion/exclusion patterns
 * - Static supportedExtensions lookup
 * - previewProject construction from cacheProject + contextSource draft
 * - Deferred rendering for non-current projects until cache is ready
 */
export function useProjectProcessingData(
  params: UseProjectProcessingDataParams
): UseProjectProcessingDataResult {
  const app = useApp();
  const { cacheProject, contextSource } = params;

  // Reason: Load the project's persistent context cache.
  // undefined = still loading, null = loaded but no cache exists, ContextCache = loaded with data.
  // Reason: Re-fetch cache when contextLoadState changes so contentEmpty detection stays current.
  const [projectCache, setProjectCache] = useState<ContextCache | null | undefined>(undefined);
  const [contextLoadState] = useProjectContextLoad();

  // Reason: reset cache to "loading" when project identity changes to avoid
  // briefly showing stale cache from the previous project during a switch.
  const cacheProjectId = cacheProject?.id;
  useEffect(() => {
    setProjectCache(undefined);
  }, [cacheProjectId]);

  useEffect(() => {
    if (!cacheProject) {
      setProjectCache(undefined);
      return;
    }
    let mounted = true;
    void ProjectContextCache.getInstance()
      .get(cacheProject)
      .then((cache) => {
        if (mounted) setProjectCache(cache);
      });
    return () => {
      mounted = false;
    };
  }, [cacheProject, contextLoadState]);

  // Reason: isCurrentProject drives whether we show live state or cache-fallback state.
  // We use cacheProject (the saved config) because the load state corresponds to
  // the already-saved configuration, not unsaved edits.
  const isCurrentProject = !!cacheProject && cacheProject.id === getCurrentProject()?.id;

  // Reason: Enumerate vault files matching inclusion/exclusion patterns.
  // Uses draft contextSource when available so unsaved edits are reflected in the file preview;
  // falls back to cacheProject.contextSource for saved-only views (e.g. ProgressCard).
  const effectiveInclusions = contextSource?.inclusions ?? cacheProject?.contextSource?.inclusions;
  const effectiveExclusions = contextSource?.exclusions ?? cacheProject?.contextSource?.exclusions;
  const [projectFiles, setProjectFiles] = useState<TFile[]>([]);
  useEffect(() => {
    if (!cacheProject) {
      setProjectFiles([]);
      return;
    }
    const { inclusions, exclusions } = getMatchingPatterns({
      inclusions: effectiveInclusions,
      exclusions: effectiveExclusions,
      isProject: true,
    });
    setProjectFiles(
      app.vault.getFiles().filter((file) => shouldIndexFile(file, inclusions, exclusions, true))
    );
  }, [app, cacheProject, effectiveInclusions, effectiveExclusions]);

  // Reason: Static method — the set of supported extensions never changes at runtime.
  const supportedExtensions = useMemo(() => FileParserManager.getProjectSupportedExtensions(), []);

  // Reason: Merge draft contextSource into cacheProject so the Content Conversion panel
  // reflects the current form state (newly added URLs show as "Pending").
  // Status data (ready/failed/processing) still comes from live state and cache.
  const displayProject = useMemo<ProjectConfig | null>(() => {
    if (!cacheProject) return null;
    // Reason: only override contextSource when a draft is explicitly provided.
    // This avoids unnecessary object creation when no draft is present.
    if (!contextSource) return cacheProject;
    return {
      ...cacheProject,
      contextSource,
    };
  }, [cacheProject, contextSource]);

  const processingData = useMemo(() => {
    if (!displayProject) return null;
    // Reason: Don't render until cache is loaded for non-current projects to avoid empty state flash.
    // Current project has live state so it can render immediately without cache.
    if (projectCache === undefined && !isCurrentProject) return null;
    return buildProcessingItems({
      project: displayProject,
      isCurrentProject,
      liveState: contextLoadState,
      projectCache,
      projectFiles,
      supportedExtensions,
    });
  }, [
    displayProject,
    isCurrentProject,
    contextLoadState,
    projectCache,
    projectFiles,
    supportedExtensions,
  ]);

  return { processingData, projectCache, isCurrentProject };
}
