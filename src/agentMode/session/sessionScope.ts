import { getCachedProjectRecordById } from "@/projects/state";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import { requireNodeModule } from "@/utils/desktopRuntime";

export class OrphanedProjectError extends Error {
  constructor(readonly projectId: ProjectScopeId) {
    super(`Project "${projectId}" is no longer available.`);
    this.name = "OrphanedProjectError";
  }
}

export function resolveScopeCwd(vaultBasePath: string, projectId: ProjectScopeId): string {
  if (projectId === GLOBAL_SCOPE) return vaultBasePath;
  const path = requireNodeModule<typeof import("node:path")>("path");
  const record = getCachedProjectRecordById(projectId);
  if (!record) throw new OrphanedProjectError(projectId);
  return path.join(vaultBasePath, path.dirname(record.filePath));
}

export function pickScopeNeighbor(
  scopeIdsAfterClose: readonly string[],
  closedIdx: number,
  mruCandidate: string | undefined
): string | null {
  if (mruCandidate && scopeIdsAfterClose.includes(mruCandidate)) return mruCandidate;
  if (scopeIdsAfterClose.length === 0) return null;
  return scopeIdsAfterClose[Math.min(closedIdx, scopeIdsAfterClose.length - 1)];
}
