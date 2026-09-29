import { getCachedProjectRecordById, getCachedProjectRecords } from "@/projects/state";
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

export function resolveProjectIdForCwd(vaultBasePath: string, cwd: string): string | undefined {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  const target = norm(cwd);
  if (target === norm(vaultBasePath)) return undefined;
  for (const record of getCachedProjectRecords()) {
    if (target === norm(path.join(vaultBasePath, path.dirname(record.filePath)))) {
      return record.project.id;
    }
  }
  return undefined;
}
