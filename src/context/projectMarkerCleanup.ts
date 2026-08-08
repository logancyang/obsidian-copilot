import { createNodeContextCacheFs } from "@/context/contextCacheFs";
import { markersDir } from "@/context/conversionsLocation";
import type { App } from "obsidian";

/**
 * Delete one project's failure-marker bucket from the off-vault conversion cache.
 *
 * Materialized snapshots (`remotes/`, `files/`) are shared vault-wide and must
 * survive deleting any single project; only the per-project `markers/<hash>/`
 * bucket is project-scoped, so that is all this removes. Recreating a project
 * under the same id would otherwise inherit stale negative-cache entries.
 *
 * Confinement: we root a {@link createNodeContextCacheFs} AT the bucket directory
 * and call its recursive `clear()`, so the wipe targets exactly that bucket and
 * cannot reach shared snapshots or sibling projects' markers. This reuses the
 * existing recursive-clear path rather than widening `remove()` (which is
 * intentionally non-recursive) to delete a non-empty directory.
 *
 * Desktop-only: it pulls in node-backed cache modules, so callers must gate on
 * the desktop runtime and dynamically import this module (mirroring the global
 * "Clear Copilot cache" command). Best-effort by construction — `clear()`
 * tolerates a missing bucket.
 */
export async function clearProjectMarkers(app: App, projectId: string): Promise<void> {
  const normalizedId = (projectId || "").trim();
  if (!normalizedId) return;
  await createNodeContextCacheFs(markersDir(app, normalizedId)).clear();
}
