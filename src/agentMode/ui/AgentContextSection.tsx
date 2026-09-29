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
  projectId: string;
  popoverContainer?: HTMLElement | null;
}

interface ContextSummary {
  totalItems: number;
  isEmpty: boolean;
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

  useEffect(() => {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- reset transient expansion when the selected context changes
    if (!pendingRef.current && !writingRef.current) setDraft(externalContext);
  }, [externalContext]);

  const flush = useCallback(() => {
    if (writingRef.current) return;
    const patch = pendingRef.current;
    if (!patch) return;
    pendingRef.current = null;
    writingRef.current = true;
    const base = getCachedProjectRecordById(projectId)?.project;
    if (!base) {
      writingRef.current = false;
      return;
    }
    ProjectFileManager.getInstance(app)
      .updateProject(projectId, { ...base, contextSource: { ...base.contextSource, ...patch } })
      .catch((err) => {
        logWarn("[project-context] failed to save context changes", err);
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
      project
    );
    modal.open();
  }, [app, project, projectId]);

  if (!project) return null;

  return (
    <div
      ref={sectionRef}
      data-copilot-drop-zone
      className={cn("tw-flex tw-min-h-48 tw-grow tw-flex-col tw-p-2")}
    >
      <ProjectContextSourceEditor
        contextSource={draft}
        onChange={handleChange}
        onManage={handleManage}
        popoverContainer={popoverContainer}
        isDragging={isDragging}
        className="tw-grow"
      />
    </div>
  );
}
