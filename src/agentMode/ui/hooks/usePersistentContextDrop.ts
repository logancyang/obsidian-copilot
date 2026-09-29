import type { ProjectConfig } from "@/aiParams";
import { logWarn } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  createPatternSettingsValue,
  getFilePattern,
  getMatchingPatterns,
} from "@/search/searchUtils";
import { App, Notice, TFile, TFolder, type TAbstractFile } from "obsidian";
import { RefObject, useEffect, useState } from "react";

export interface UsePersistentContextDropProps {
  app: App;
  projectId: string;
  dropRef: RefObject<HTMLElement>;
  enabled?: boolean;
}

export interface UsePersistentContextDropReturn {
  isDragging: boolean;
}

const INTERNAL_DRAG_TYPE = "copilot/internal-drag";

function obsidianOpenFileParam(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "obsidian:" || url.hostname !== "open") return null;
    return url.searchParams.get("file");
  } catch {
    return null;
  }
}

function resolveDroppedAbstractFile(app: App, raw: string): TAbstractFile | null {
  const line = raw.trim();
  if (!line) return null;

  const path = obsidianOpenFileParam(line) ?? line;
  return (
    app.vault.getAbstractFileByPath(path) ?? app.vault.getAbstractFileByPath(`${path}.md`) ?? null
  );
}

async function persistInclusions(
  app: App,
  projectId: string,
  files: TAbstractFile[]
): Promise<number> {
  const record = getCachedProjectRecordById(projectId);
  if (!record) {
    new Notice("Project not found — could not add to context");
    return 0;
  }

  const project = record.project;
  const { inclusions: existing } = getMatchingPatterns({
    inclusions: project.contextSource?.inclusions,
    isProject: true,
  });
  const folderPatterns = new Set(existing?.folderPatterns ?? []);
  const notePatterns = new Set(existing?.notePatterns ?? []);
  const tagPatterns = new Set(existing?.tagPatterns ?? []);
  const extensionPatterns = new Set(existing?.extensionPatterns ?? []);
  const propertyPatterns = new Set(existing?.propertyPatterns ?? []);

  let added = 0;
  for (const file of files) {
    if (file instanceof TFolder) {
      if (file.path && !folderPatterns.has(file.path)) {
        folderPatterns.add(file.path);
        added++;
      }
    } else if (file instanceof TFile) {
      const pattern = getFilePattern(file);
      if (!notePatterns.has(pattern)) {
        notePatterns.add(pattern);
        added++;
      }
    }
  }

  if (added === 0) return 0;

  const inclusions = createPatternSettingsValue({
    tagPatterns: [...tagPatterns],
    extensionPatterns: [...extensionPatterns],
    folderPatterns: [...folderPatterns],
    notePatterns: [...notePatterns],
    propertyPatterns: [...propertyPatterns],
  });
  const next: ProjectConfig = {
    ...project,
    contextSource: { ...project.contextSource, inclusions },
  };
  await ProjectFileManager.getInstance(app).updateProject(projectId, next);
  return added;
}

async function collectDroppedFiles(app: App, items: DataTransferItem[]): Promise<TAbstractFile[]> {
  const strings = await Promise.all(
    items.map(
      (item) =>
        new Promise<string>((resolve) => {
          item.getAsString((data) => resolve(data));
        })
    )
  );

  const byPath = new Map<string, TAbstractFile>();
  for (const raw of strings) {
    for (const line of raw.split("\n")) {
      const file = resolveDroppedAbstractFile(app, line);
      if (file) byPath.set(file.path, file);
    }
  }
  return [...byPath.values()];
}

export function usePersistentContextDrop(
  props: UsePersistentContextDropProps
): UsePersistentContextDropReturn {
  const { app, projectId, dropRef, enabled = true } = props;
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const zone = dropRef.current;
    if (!zone || !enabled) return;

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (e.dataTransfer.types.includes(INTERNAL_DRAG_TYPE)) return;
      e.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      const rect = zone.getBoundingClientRect();
      const { clientX: x, clientY: y } = e;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.types.includes(INTERNAL_DRAG_TYPE)) return;

      const all = Array.from(e.dataTransfer.items);
      const stringItems = all.filter((item) => item.kind === "string");
      const hasExternalFiles = all.some((item) => item.kind === "file");

      const files = stringItems.length > 0 ? await collectDroppedFiles(app, stringItems) : [];
      if (files.length === 0) {
        if (hasExternalFiles) {
          new Notice("Only vault files or folders can be added to project context");
        }
        return;
      }

      try {
        const added = await persistInclusions(app, projectId, files);
        if (added > 0) {
          new Notice("Added to project context");
        } else {
          new Notice("Already in project context");
        }
      } catch (err) {
        logWarn("[project-context] failed to add dropped inclusion", err);
        new Notice("Could not add to project context");
      }
    };

    const onDrop = (e: DragEvent) => void handleDrop(e);
    zone.addEventListener("dragover", handleDragOver);
    zone.addEventListener("dragleave", handleDragLeave);
    zone.addEventListener("drop", onDrop);
    return () => {
      zone.removeEventListener("dragover", handleDragOver);
      zone.removeEventListener("dragleave", handleDragLeave);
      zone.removeEventListener("drop", onDrop);
    };
  }, [app, projectId, dropRef, enabled]);

  return { isDragging };
}
