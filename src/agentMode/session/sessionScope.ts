import { dirname, join } from "node:path";
import { getCachedProjectRecordById, getCachedProjectRecords } from "@/projects/state";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";

/**
 * Raised when a project-scoped session points at a project whose registry
 * record is gone (the project folder/config was deleted out from under it).
 * Callers turn this into an "orphaned" experience (Notice + blocked send)
 * instead of silently re-homing the session to the vault root.
 */
export class OrphanedProjectError extends Error {
  constructor(readonly projectId: ProjectScopeId) {
    super(`Project "${projectId}" is no longer available.`);
    this.name = "OrphanedProjectError";
  }
}

/**
 * Absolute working directory for a session bound to `projectId`.
 * - {@link GLOBAL_SCOPE} → the vault root.
 * - a real project → that project's folder (the parent dir of its config file).
 *
 * A missing record is treated as orphaned and throws: never downgrade to the
 * vault root, which would silently widen a "project" session to the whole vault.
 */
export function resolveScopeCwd(vaultBasePath: string, projectId: ProjectScopeId): string {
  if (projectId === GLOBAL_SCOPE) return vaultBasePath;
  const record = getCachedProjectRecordById(projectId);
  if (!record) throw new OrphanedProjectError(projectId);
  // Reason: project folders live at `dirname(config)`; a config sitting at the
  // vault root yields ".", which join() collapses back to the vault root.
  return join(vaultBasePath, dirname(record.filePath));
}

/** Whether `projectId` still resolves to a live scope (global is always live). */
export function isLiveScope(projectId: ProjectScopeId): boolean {
  return projectId === GLOBAL_SCOPE || getCachedProjectRecordById(projectId) !== undefined;
}

/**
 * Reverse of {@link resolveScopeCwd}: attribute a working directory reported by
 * a backend's native `listSessions` to the project whose folder it is. Lets the
 * session-index sweep scope sessions started OUTSIDE the plugin (e.g. a CLI run
 * inside a materialized project folder). Returns undefined for the vault root
 * and for any path that matches no known project folder — exact folder match
 * only, deliberately not "inside a project folder", mirroring the sweep's
 * exact-cwd vault filter.
 */
export function resolveProjectIdForCwd(vaultBasePath: string, cwd: string): string | undefined {
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  const target = norm(cwd);
  if (target === norm(vaultBasePath)) return undefined;
  for (const record of getCachedProjectRecords()) {
    if (target === norm(join(vaultBasePath, dirname(record.filePath)))) {
      return record.project.id;
    }
  }
  return undefined;
}

/**
 * Pick the session that becomes active after closing one inside a scope, never
 * leaving the scope: most-recently-used (if still alive) → the slot the closed
 * session occupied (right neighbour, clamped to the new last) → `null` when the
 * scope is now empty.
 *
 * @param scopeIdsAfterClose session ids remaining in the scope, in tab order.
 * @param closedIdx index the closed session held within the scope before removal.
 * @param mruCandidate the scope's recorded MRU id, if any.
 */
export function pickScopeNeighbor(
  scopeIdsAfterClose: readonly string[],
  closedIdx: number,
  mruCandidate: string | undefined
): string | null {
  if (mruCandidate && scopeIdsAfterClose.includes(mruCandidate)) return mruCandidate;
  if (scopeIdsAfterClose.length === 0) return null;
  return scopeIdsAfterClose[Math.min(closedIdx, scopeIdsAfterClose.length - 1)];
}
