import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileRecord } from "@/projects/type";
import { normalizePath } from "obsidian";

const projectsStore = createStore();

const projectRecordsAtom = atom<ProjectFileRecord[]>([]);

const projectConfigsAtom = atom<ProjectConfig[]>((get) =>
  get(projectRecordsAtom).map((r) => r.project)
);

export function useProjects(): ProjectConfig[] {
  return useAtomValue(projectConfigsAtom, { store: projectsStore });
}

export function getCachedProjectRecords(): ProjectFileRecord[] {
  return projectsStore.get(projectRecordsAtom);
}

export function getCachedProjectRecordById(projectId: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.project.id === projectId);
}

export function getCachedProjectRecordByFilePath(filePath: string): ProjectFileRecord | undefined {
  return projectsStore.get(projectRecordsAtom).find((r) => r.filePath === filePath);
}

export function updateCachedProjectRecords(records: ProjectFileRecord[]): void {
  projectsStore.set(projectRecordsAtom, records);
}

export function replaceCachedProjectRecordByFilePath(
  filePath: string,
  record: ProjectFileRecord
): void {
  const prev = projectsStore.get(projectRecordsAtom);

  const existingIndex = prev.findIndex((r) => r.filePath === filePath);

  if (existingIndex !== -1) {
    const updated = prev.filter(
      (r, i) => i === existingIndex || r.project.id !== record.project.id
    );
    const newIndex = updated.findIndex((r) => r.filePath === filePath);
    updated[newIndex] = record;
    projectsStore.set(projectRecordsAtom, updated);
  } else {
    const withoutId = prev.filter((r) => r.project.id !== record.project.id);
    projectsStore.set(projectRecordsAtom, [...withoutId, record]);
  }
}

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

export function deleteCachedProjectRecordById(projectId: string): void {
  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(
    projectRecordsAtom,
    records.filter((r) => r.project.id !== projectId)
  );
}

export function deleteCachedProjectRecordByFilePath(filePath: string): void {
  const records = projectsStore.get(projectRecordsAtom);
  projectsStore.set(
    projectRecordsAtom,
    records.filter((r) => r.filePath !== filePath)
  );
}

export function subscribeToProjectRecords(
  callback: (records: ProjectFileRecord[]) => void
): () => void {
  return projectsStore.sub(projectRecordsAtom, () => {
    callback(projectsStore.get(projectRecordsAtom));
  });
}

const pendingFileWrites = new Map<string, number>();

export function addPendingFileWrite(path: string): void {
  const key = normalizePath(path);
  pendingFileWrites.set(key, (pendingFileWrites.get(key) ?? 0) + 1);
}

export function removePendingFileWrite(path: string): void {
  const key = normalizePath(path);
  const count = (pendingFileWrites.get(key) ?? 0) - 1;
  if (count <= 0) {
    pendingFileWrites.delete(key);
  } else {
    pendingFileWrites.set(key, count);
  }
}

export function isPendingFileWrite(path: string): boolean {
  return (pendingFileWrites.get(normalizePath(path)) ?? 0) > 0;
}
