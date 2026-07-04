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

/**
 * Props for {@link usePersistentContextDrop}.
 *
 * Distinct from `useChatFileDrop` on purpose: that hook adds notes to the
 * CURRENT message draft (transient), this one writes a PERSISTENT project
 * inclusion that applies to future chats. The two live in different drop zones
 * inside the same chat container, split by a two-sided contract: the container
 * hook yields while a drag hovers an element marked `data-copilot-drop-zone`
 * (its capture-phase check), and this hook `stopPropagation()`s only on DROP so
 * the dropped item doesn't also land in the draft. dragover is left bubbling —
 * Obsidian's drag manager repositions the drag ghost at the document level.
 */
export interface UsePersistentContextDropProps {
  /** Obsidian app instance for vault lookups + project writes. */
  app: App;
  /** Project whose `contextSource.inclusions` receives the dropped item. */
  projectId: string;
  /** The drop-zone element; native drag listeners attach here. */
  dropRef: RefObject<HTMLElement>;
  /** When false, listeners are not attached (e.g. section collapsed). */
  enabled?: boolean;
}

export interface UsePersistentContextDropReturn {
  /** True while a droppable drag hovers the zone — drives the hover styling. */
  isDragging: boolean;
}

/** Drag originating inside the plugin (e.g. relevant-note chips) — never a drop target. */
const INTERNAL_DRAG_TYPE = "copilot/internal-drag";

/**
 * Extract the `file` param from an `obsidian://open?...` URI, or null when the
 * input isn't such a URI. Parses by query key (not a greedy tail match) so extra
 * params like `&line=12` don't get folded into the path.
 */
function obsidianOpenFileParam(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "obsidian:" || url.hostname !== "open") return null;
    return url.searchParams.get("file");
  } catch {
    return null;
  }
}

/**
 * Resolve one dropped line to a vault file or folder. Accepts both the
 * `obsidian://open?...&file=<path>` URI form (nav-bar / explorer drags) and a
 * bare vault-relative path, and retries with a `.md` suffix for extensionless
 * note links. Returns a {@link TFolder} as well as a {@link TFile} — folders are
 * valid project inclusions (the materializer pulls the whole directory).
 */
function resolveDroppedAbstractFile(app: App, raw: string): TAbstractFile | null {
  const line = raw.trim();
  if (!line) return null;

  const path = obsidianOpenFileParam(line) ?? line;
  return (
    app.vault.getAbstractFileByPath(path) ?? app.vault.getAbstractFileByPath(`${path}.md`) ?? null
  );
}

/**
 * Persist the dropped vault items as project inclusions. Idempotent: a
 * folder becomes a bare folder pattern, a file becomes a `[[basename]]` note
 * pattern; anything already present is skipped. Re-encodes via the canonical
 * `createPatternSettingsValue` helper (never a raw append) and writes through
 * `updateProject`. Returns the number of new patterns added.
 */
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

  let added = 0;
  for (const file of files) {
    if (file instanceof TFolder) {
      // Skip the vault root (empty path): it would include everything.
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
  });
  const next: ProjectConfig = {
    ...project,
    contextSource: { ...project.contextSource, inclusions },
  };
  await ProjectFileManager.getInstance(app).updateProject(projectId, next);
  return added;
}

/**
 * Read every string item off a drop event (each `getAsString` is async, so
 * collect the promises first to avoid races), then resolve them to vault
 * files/folders. Multi-file nav-bar drags arrive as a single newline-joined
 * string, so split each item by line.
 */
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

/**
 * Native drag-and-drop for the project Context section's drop zone. Writes a
 * PERSISTENT inclusion (applies to new chats; no mid-session re-materialize) and
 * rejects external OS files, which can't become vault inclusions.
 */
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
      // NO stopPropagation here: the dragover must keep bubbling to the
      // document, where Obsidian's drag manager repositions the drag ghost —
      // swallowing it freezes the ghost at the zone's edge. The container's
      // chat-file handler yields on its own (capture-phase
      // `data-copilot-drop-zone` check in useChatFileDrop), so there's nothing
      // to suppress.
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
