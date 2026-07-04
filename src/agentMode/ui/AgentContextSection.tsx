import { SHELF_BODY_FLOOR_CLASS } from "@/agentMode/ui/AgentHomeShelf";
import type { ProjectConfig } from "@/aiParams";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { buildBadgeItems } from "@/components/project/ProjectContextBadgeList";
import { ProjectContextSourceEditor } from "@/components/project/ProjectContextSourceEditor";
import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import { parseProjectUrls } from "@/utils/urlTagUtils";
import { App } from "obsidian";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentContextDrop } from "./hooks/usePersistentContextDrop";

type ContextSource = NonNullable<ProjectConfig["contextSource"]>;

interface AgentContextSectionProps {
  app: App;
  /** Project whose context (inclusions/URLs) this section summarizes + edits. */
  projectId: string;
  /** Portal target for the editor's +URL popover — the AgentHome root, so it
   * resolves to the correct document in popout windows. */
  popoverContainer?: HTMLElement | null;
}

interface ContextSummary {
  totalItems: number;
  isEmpty: boolean;
  /** Per-type counts, matching the badge list's categorizer + the URL parser. */
  files: number;
  folders: number;
  tags: number;
  extensions: number;
  urls: number;
}

const EMPTY_SUMMARY: ContextSummary = Object.freeze({
  totalItems: 0,
  isEmpty: true,
  files: 0,
  folders: 0,
  tags: 0,
  extensions: 0,
  urls: 0,
});

/**
 * Summarize a project's context for the section header + breakdown line. Counts
 * inclusions via {@link buildBadgeItems} and URLs via {@link parseProjectUrls} —
 * the SAME parsers the reused editor renders with — so the counts match the
 * expanded editor exactly. Pure / testable.
 */
export function buildContextSummary(project: ProjectConfig | undefined): ContextSummary {
  if (!project) return EMPTY_SUMMARY;

  const badgeItems = buildBadgeItems(project.contextSource?.inclusions);
  const counts = { files: 0, folders: 0, tags: 0, extensions: 0 };
  for (const item of badgeItems) {
    if (item.type === "note") counts.files++;
    else if (item.type === "folder") counts.folders++;
    else if (item.type === "tag") counts.tags++;
    else counts.extensions++;
  }

  const urls = parseProjectUrls(
    project.contextSource?.webUrls ?? "",
    project.contextSource?.youtubeUrls ?? ""
  ).length;

  const totalItems = badgeItems.length + urls;
  if (totalItems === 0) return EMPTY_SUMMARY;

  return { totalItems, isEmpty: false, ...counts, urls };
}

/**
 * The project Context body on the agent landing — a single
 * {@link ProjectContextSourceEditor} (mixed file + URL chips, +URL, Manage)
 * wired to immediate persistence. Edits/drops apply to NEW chats.
 *
 * Persistence is optimistic + serialized to fix the prior drop-write race:
 * `onChange` updates a local `draft` (so the chip vanishes instantly) and queues
 * a patch; a single in-flight `updateProject` drains the queue, each write
 * rebased on the freshest persisted config (`getCachedProjectRecordById`) so
 * rapid successive removals compose instead of clobbering each other. External
 * record changes are adopted into the draft only while no write is pending.
 *
 * The root keeps the drop ref, the `data-copilot-drop-zone` marker, AND the
 * height floor on the SAME element: that marker tells the chat container's
 * draft-attach handler (useChatFileDrop) to yield while a drag hovers this body,
 * so a taller wrapper would leave a dead strip where drops fall through to the
 * draft. The floor is the shelf panel's SHELF_BODY_FLOOR_CLASS (imported, not
 * hand-copied) and also covers this section's standalone (no-shelf) rendering;
 * `tw-grow` on the editor fills that floor.
 */
export default function AgentContextSection({
  app,
  projectId,
  popoverContainer,
}: AgentContextSectionProps) {
  const projects = useProjects();
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const externalContext = project?.contextSource;

  const [draft, setDraft] = useState<ContextSource | undefined>(externalContext);
  const pendingRef = useRef<Partial<ContextSource> | null>(null);
  const writingRef = useRef(false);

  // Adopt external changes only when nothing optimistic is queued/in flight, so a
  // background record refresh can't resurrect a chip the user just removed. This
  // is the intended prop→optimistic-state sync; the lint rule's blanket warning
  // about set-state-in-effect doesn't fit a guarded reconciliation like this.
  useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    if (!pendingRef.current && !writingRef.current) setDraft(externalContext);
  }, [externalContext]);

  const flush = useCallback(() => {
    if (writingRef.current) return;
    const patch = pendingRef.current;
    if (!patch) return;
    pendingRef.current = null;
    writingRef.current = true;
    // Rebase each write on the freshest persisted config so queued patches
    // compose rather than race on a stale closure-captured base.
    const base = getCachedProjectRecordById(projectId)?.project;
    if (!base) {
      writingRef.current = false;
      return;
    }
    ProjectFileManager.getInstance(app)
      .updateProject(projectId, { ...base, contextSource: { ...base.contextSource, ...patch } })
      .catch((err) => {
        logWarn("[project-context] failed to save context changes", err);
        // The optimistic draft assumed this write would land. With no further
        // pending patch to reconcile it, resync the draft to the persisted config
        // so the UI can't drift from disk (a removed chip reappearing, etc.).
        if (!pendingRef.current) {
          setDraft(getCachedProjectRecordById(projectId)?.project.contextSource);
        }
      })
      .finally(() => {
        writingRef.current = false;
        if (pendingRef.current) flush();
      });
  }, [app, projectId]);

  const handleChange = useCallback(
    (patch: Partial<ContextSource>) => {
      setDraft((prev) => ({ ...(prev ?? {}), ...patch }));
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      flush();
    },
    [flush]
  );

  const sectionRef = useRef<HTMLDivElement>(null);
  const { isDragging } = usePersistentContextDrop({ app, projectId, dropRef: sectionRef });

  const handleManage = useCallback(() => {
    if (!project) return;
    const modal = new ContextManageModal(
      app,
      (updated) => {
        ProjectFileManager.getInstance(app)
          .updateProject(projectId, updated)
          .catch((err) => logWarn("[project-context] failed to save context changes", err));
      },
      project,
      { enableLinks: true }
    );
    modal.open();
  }, [app, project, projectId]);

  // Orphaned/unknown project: nothing to edit.
  if (!project) return null;

  return (
    <div
      ref={sectionRef}
      data-copilot-drop-zone
      className={cn(SHELF_BODY_FLOOR_CLASS, "tw-flex tw-grow tw-flex-col tw-p-2")}
    >
      <ProjectContextSourceEditor
        contextSource={draft}
        onChange={handleChange}
        onManage={handleManage}
        popoverContainer={popoverContainer}
        isDragging={isDragging}
        // Fill the shelf floor; the editor's own max-height caps it so a long
        // context scrolls inside the box instead of taking over the whole tab.
        className="tw-grow"
      />
    </div>
  );
}
