import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileRecord } from "@/projects/type";
import { normalizePath } from "obsidian";

// Independent store for projects (aligned with system-prompts pattern)
const projectsStore = createStore();

const projectRecordsAtom = atom<ProjectFileRecord[]>([]);

// Reason: derived atom so that useProjects() returns a stable array reference
// (only recomputed when projectRecordsAtom changes, not on every parent render).
const projectConfigsAtom = atom<ProjectConfig[]>((get) =>
  get(projectRecordsAtom).map((r) => r.project)
);

/**
 * React hook: get all ProjectConfig objects (convenience wrapper).
 * Uses a derived atom so the array reference is stable across re-renders.
 * @returns Array of ProjectConfig
 */
export function useProjects(): ProjectConfig[] {
  return useAtomValue(projectConfigsAtom, { store: projectsStore });
}

/**
 * Non-reactive: get cached project records.
 * @returns Array of ProjectFileRecord
 */
export function getCachedProjectRecords(): ProjectFileRecord[] {
  return projectsStore.get(projectRecordsAtom);
}

/**
 * Non-reactive: get cached ProjectConfig objects.
 * @returns Array of ProjectConfig
 */
export function getCachedProjects(): ProjectConfig[] {
  return projectsStore.get(projectRecordsAtom).map((r) => r.project);
}

/**
 * Non-reactive: find a cached record by project id.
 * @param projectId - Project id to look up
 * @returns Matching record or undefined
 */
export function getCachedProjectRecordById(projectId: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.project.id === projectId);
}

/**
 * Non-reactive: find a cached record by file path.
 * @param filePath - Vault path of project.md
 * @returns Matching record or undefined
 */
export function getCachedProjectRecordByFilePath(filePath: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.filePath === filePath);
}

/**
 * Replace all cached project records.
 * @param records - New array of ProjectFileRecord
 */
export function updateCachedProjectRecords(records: ProjectFileRecord[]): void {
  projectsStore.set(projectRecordsAtom, records);
}

/**
 * Replace the cached record for a given file path in a single store write.
 * Avoids transient "disappear/reappear" gaps for subscribers during modify events,
 * while still cleaning up stale entries when the frontmatter id changes.
 *
 * @param filePath - Vault path of project.md being modified
 * @param record - Parsed record to store for that file
 */
export function replaceCachedProjectRecordByFilePath(
  filePath: string,
  record: ProjectFileRecord
): void {
  const prev = projectsStore.get(projectRecordsAtom);

  // Reason: find the original index by filePath to preserve array order (avoid moving to end on
  // every modify). If the record exists, replace in-place; otherwise append.
  const existingIndex = prev.findIndex((r) => r.filePath === filePath);

  if (existingIndex !== -1) {
    // Reason: also remove any other entry with the same id but different filePath (stale duplicate),
    // then replace in-place at the original position.
    const updated = prev.filter(
      (r, i) => i === existingIndex || r.project.id !== record.project.id
    );
    const newIndex = updated.findIndex((r) => r.filePath === filePath);
    updated[newIndex] = record;
    projectsStore.set(projectRecordsAtom, updated);
  } else {
    // New filePath: remove any stale id match, then append
    const withoutId = prev.filter((r) => r.project.id !== record.project.id);
    projectsStore.set(projectRecordsAtom, [...withoutId, record]);
  }
}

/**
 * Add or update a project record by project.id.
 * @param record - ProjectFileRecord to upsert
 */
export function upsertCachedProjectRecord(record: ProjectFileRecord): void {
  const records = projectsStore.get(projectRecordsAtom);
  const existingIndex = records.findIndex((r) => r.project.id === record.project.id);

  if (existingIndex !== -1) {
    const updated = [...records];
    updated[existingIndex] = record;
    projectsStore.set(projectRecordsAtom, updated);
  } else {
    projectsStore.set(projectRecordsAtom, [...records, record]);
  }
}

/**
 * Remove a project record by project id.
 * @param projectId - Project id to remove
 */
export function deleteCachedProjectRecordById(projectId: string): void {
  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(
    projectRecordsAtom,
    records.filter((r) => r.project.id !== projectId)
  );
}

/**
 * Remove a project record by file path (used for delete/rename events).
 * @param filePath - Vault path of project.md
 */
export function deleteCachedProjectRecordByFilePath(filePath: string): void {
  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(
    projectRecordsAtom,
    records.filter((r) => r.filePath !== filePath)
  );
}

/**
 * Subscribe to project records changes (for non-React code like projectManager).
 * Returns an unsubscribe function.
 * @param callback - Called with the new records array whenever it changes
 * @returns Unsubscribe function
 */
export function subscribeToProjectRecords(
  callback: (records: ProjectFileRecord[]) => void
): () => void {
  return projectsStore.sub(projectRecordsAtom, () => {
    callback(projectsStore.get(projectRecordsAtom));
  });
}

// Reason: use a ref-counted Map instead of a plain Set so overlapping async writes to the
// same path don't prematurely clear the guard when the first writer finishes.
const pendingFileWrites = new Map<string, number>();

/** Mark a file path as pending write (normalizes path to avoid mismatches). */
export function addPendingFileWrite(path: string): void {
  const key = normalizePath(path);
  pendingFileWrites.set(key, (pendingFileWrites.get(key) ?? 0) + 1);
}

/** Remove a file path from pending writes (normalizes path to avoid mismatches). */
export function removePendingFileWrite(path: string): void {
  const key = normalizePath(path);
  const count = (pendingFileWrites.get(key) ?? 0) - 1;
  if (count <= 0) {
    pendingFileWrites.delete(key);
  } else {
    pendingFileWrites.set(key, count);
  }
}

/** Check if a file path is pending write (normalizes path to avoid mismatches). */
export function isPendingFileWrite(path: string): boolean {
  return (pendingFileWrites.get(normalizePath(path)) ?? 0) > 0;
}
