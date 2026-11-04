import { FileStatusLabel } from "@/agentMode/ui/FileChangeSummary";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { VaultItemSearchModal } from "@/components/modals/VaultItemSearchModal";
import { useApp } from "@/context";
import { canAttachFileToChat } from "@/hooks/useChatFileDrop";
import { AGENTS_FILE_NAME } from "@/instructions/agentsFile";
import { INTERNAL_DRAG_TYPE, useNoteDrag } from "@/hooks/useNoteDrag";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { PROJECT_SOURCES_FOLDER_NAME } from "@/projects/constants";
import {
  copyIntoProjectSources,
  getDraggedVaultItems,
  linkProjectItems,
  unlinkProjectPattern,
} from "@/projects/projectLinks";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import { categorizePatterns, getDecodedPatterns } from "@/search/searchUtils";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { openFileInTab, openLinkClickProps, type OpenPane } from "@/utils/openVaultPath";
import { ChevronRight, File, Folder, Plus, X } from "lucide-react";
import { App, Menu, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import React, { useEffect, useId, useReducer, useState } from "react";

interface ProjectFileNode {
  kind: "file";
  path: string;
  name: string;
}

interface ProjectFolderNode {
  kind: "folder";
  path: string;
  name: string;
  children: readonly ProjectTreeNode[] | null;
}

export type ProjectTreeNode = ProjectFileNode | ProjectFolderNode;

export interface RecentProjectFile {
  path: string;
  name: string;
  folder: string;
  change: "new" | "edited";
  mtime: number;
}

export interface LinkedProjectRow {
  pattern: string;
  node: ProjectTreeNode;
  parent: string;
  missing: boolean;
}

const EMPTY_TREE: readonly ProjectTreeNode[] = Object.freeze([]);
const EMPTY_RECENT: readonly RecentProjectFile[] = Object.freeze([]);
const EMPTY_LINKED: readonly LinkedProjectRow[] = Object.freeze([]);
const RECENT_FILE_LIMIT = 5;
const NEW_FILE_WINDOW_MS = 60_000;
const AGE_REFRESH_MS = 60_000;
const NO_PATHS: ReadonlySet<string> = new Set();
const FILE_MENU_SOURCE = "copilot-project-files";

export function buildProjectTree(
  folder: TFolder,
  expandedPaths: ReadonlySet<string>,
  configPath: string
): readonly ProjectTreeNode[] {
  const visible = folder.children.filter(
    (child) => !child.name.startsWith(".") && child.path !== configPath
  );
  if (visible.length === 0) return EMPTY_TREE;
  return visible
    .sort(
      (a, b) =>
        Number(b instanceof TFolder) - Number(a instanceof TFolder) ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
    )
    .map((child): ProjectTreeNode => {
      if (!(child instanceof TFolder)) return { kind: "file", path: child.path, name: child.name };
      // Only expanded folders are read, so a project with hundreds of outputs stays responsive.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/462
      const children = expandedPaths.has(child.path)
        ? buildProjectTree(child, expandedPaths, configPath)
        : null;
      return { kind: "folder", path: child.path, name: child.name, children };
    });
}

export function buildRecentFiles(
  folder: TFolder,
  configPath: string,
  linkedPaths: ReadonlySet<string> = NO_PATHS
): readonly RecentProjectFile[] {
  const hidden = new Set([
    ...linkedPaths,
    configPath,
    `${folder.path}/${AGENTS_FILE_NAME}`,
    `${folder.path}/${PROJECT_SOURCES_FOLDER_NAME}`,
  ]);
  const files: TFile[] = [];
  const collect = (parent: TFolder): void => {
    for (const child of parent.children) {
      if (child.name.startsWith(".") || hidden.has(child.path)) continue;
      if (child instanceof TFolder) collect(child);
      else if (child instanceof TFile) files.push(child);
    }
  };
  collect(folder);
  if (files.length === 0) return EMPTY_RECENT;
  return files
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, RECENT_FILE_LIMIT)
    .map((file) => {
      const { ctime, mtime } = file.stat;
      return {
        path: file.path,
        name: file.name,
        folder: file.path.slice(folder.path.length + 1, -file.name.length),
        change: Math.abs(mtime - ctime) < NEW_FILE_WINDOW_MS ? "new" : "edited",
        mtime,
      };
    });
}

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

export function buildLinkedRows(
  app: App,
  inclusions: string | undefined,
  expandedPaths: ReadonlySet<string>,
  configPath: string
): readonly LinkedProjectRow[] {
  const { folderPatterns, notePatterns } = categorizePatterns([
    ...new Set(getDecodedPatterns(inclusions ?? "")),
  ]);
  if (folderPatterns.length + notePatterns.length === 0) return EMPTY_LINKED;
  const folderRows = folderPatterns.map((pattern): LinkedProjectRow => {
    const path = pattern.replace(/\/+$/, "");
    const folder = app.vault.getAbstractFileByPath(path);
    const children =
      folder instanceof TFolder && expandedPaths.has(path)
        ? buildProjectTree(folder, expandedPaths, configPath)
        : null;
    const name = path.slice(path.lastIndexOf("/") + 1);
    return {
      pattern,
      node: { kind: "folder", path, name, children },
      parent: parentPath(path),
      missing: !(folder instanceof TFolder),
    };
  });
  const files = notePatterns.length > 0 ? app.vault.getFiles() : [];
  const noteRows = notePatterns.flatMap((pattern): LinkedProjectRow[] => {
    const title = pattern.slice(2, -2);
    const matches = files.filter((file) => file.basename === title);
    if (matches.length === 0) {
      return [
        { pattern, node: { kind: "file", path: pattern, name: title }, parent: "", missing: true },
      ];
    }
    return matches.map((file) => ({
      pattern,
      node: { kind: "file", path: file.path, name: file.name },
      parent: parentPath(file.path),
      missing: false,
    }));
  });
  return [...folderRows, ...noteRows];
}

interface FileManagerPrompts {
  promptForFileRename(file: TFile): Promise<void>;
  promptForDeletion(file: TAbstractFile): Promise<boolean>;
}

interface ProjectTreeHandlers {
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string, pane: OpenPane) => void;
  onShowFileMenu: (path: string, event: React.MouseEvent) => void;
  onDragFile: (path: string, event: React.DragEvent) => void;
}

interface ProjectTreeRowsProps extends ProjectTreeHandlers {
  nodes: readonly ProjectTreeNode[];
}

function ProjectTreeRows({ nodes, ...handlers }: ProjectTreeRowsProps): React.ReactElement {
  return (
    <>
      {nodes.map((node) => (
        <ProjectTreeRow key={node.path} node={node} {...handlers} />
      ))}
    </>
  );
}

interface ProjectTreeRowProps extends ProjectTreeHandlers {
  node: ProjectTreeNode;
  detail?: string;
}

interface ProjectRowProps extends Pick<ProjectTreeHandlers, "onShowFileMenu" | "onDragFile"> {
  path: string;
  expanded?: boolean;
  onActivate: (pane: OpenPane) => void;
  children: React.ReactNode;
}

function ProjectRow({
  path,
  expanded,
  onActivate,
  onShowFileMenu,
  onDragFile,
  children,
}: ProjectRowProps): React.ReactElement {
  const isFolder = expanded !== undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      draggable={!isFolder}
      className="tw-flex tw-min-w-0 tw-cursor-pointer tw-items-center tw-gap-1.5 tw-rounded tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-normal hover:tw-bg-modifier-hover"
      {...(isFolder ? { onClick: () => onActivate(false) } : openLinkClickProps(onActivate))}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate(false);
      }}
      onContextMenu={(event) => onShowFileMenu(path, event)}
      onDragStart={isFolder ? undefined : (event) => onDragFile(path, event)}
    >
      {children}
    </div>
  );
}

function ProjectTreeRow({ node, detail, ...handlers }: ProjectTreeRowProps): React.ReactElement {
  const isFolder = node.kind === "folder";
  const expanded = isFolder && node.children !== null;
  const Icon = isFolder ? Folder : File;

  return (
    <>
      <ProjectRow
        path={node.path}
        expanded={isFolder ? expanded : undefined}
        onActivate={(pane) =>
          isFolder ? handlers.onToggleFolder(node.path) : handlers.onOpenFile(node.path, pane)
        }
        onShowFileMenu={handlers.onShowFileMenu}
        onDragFile={handlers.onDragFile}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "tw-size-3.5 tw-shrink-0 tw-text-faint",
            !isFolder && "tw-invisible",
            expanded && "tw-rotate-90"
          )}
        />
        <Icon aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-faint" />
        <span className="tw-min-w-0 tw-truncate" title={node.name}>
          {node.name}
        </span>
        {detail && (
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-smaller tw-text-faint">
            {detail}
          </span>
        )}
      </ProjectRow>
      {isFolder && node.children !== null && node.children.length > 0 && (
        <div
          role="group"
          aria-label={node.name}
          className="tw-ml-3 tw-border-0 tw-border-l tw-border-solid tw-border-border tw-pl-1"
        >
          <ProjectTreeRows nodes={node.children} {...handlers} />
        </div>
      )}
    </>
  );
}

export interface ProjectFolderSectionProps extends ProjectTreeHandlers {
  folderPath: string;
  nodes: readonly ProjectTreeNode[];
}

interface ProjectFilesSectionProps {
  title: string;
  detail?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function ProjectFilesSection({
  title,
  detail,
  action,
  children,
}: ProjectFilesSectionProps): React.ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="tw-flex tw-min-w-0 tw-flex-col tw-p-1">
      <div className="tw-flex tw-min-w-0 tw-items-baseline tw-gap-2 tw-px-1.5 tw-pb-1 tw-pt-1.5">
        <span
          id={headingId}
          className="tw-shrink-0 tw-text-ui-smaller tw-font-semibold tw-text-faint"
        >
          {title}
        </span>
        {detail && (
          <span className="tw-min-w-0 tw-truncate tw-text-ui-smaller tw-text-faint" title={detail}>
            {detail}
          </span>
        )}
        {action && <div className="tw-ml-auto tw-self-center">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function ProjectFolderSection({
  folderPath,
  nodes,
  ...handlers
}: ProjectFolderSectionProps): React.ReactElement {
  return (
    <ProjectFilesSection title="Project folder" detail={folderPath}>
      {nodes.length === 0 ? (
        <div className="tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-faint">No files yet.</div>
      ) : (
        <ProjectTreeRows nodes={nodes} {...handlers} />
      )}
    </ProjectFilesSection>
  );
}

function formatRecentAge(mtime: number, now: number): string {
  const age = formatCompactRelativeTime(mtime, now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  // Returning users read a day-old change as "yesterday", but only when it was made on yesterday's date.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/463
  const onYesterday = new Date(mtime).toDateString() === yesterday.toDateString();
  return age === "1d" && onYesterday ? "yesterday" : age;
}

export interface RecentFilesSectionProps extends Pick<
  ProjectTreeHandlers,
  "onOpenFile" | "onShowFileMenu" | "onDragFile"
> {
  files: readonly RecentProjectFile[];
  now: number;
}

export function RecentFilesSection({
  files,
  now,
  onOpenFile,
  ...rowHandlers
}: RecentFilesSectionProps): React.ReactElement | null {
  if (files.length === 0) return null;
  return (
    <ProjectFilesSection title="Recent">
      {files.map((file) => (
        <ProjectRow
          key={file.path}
          path={file.path}
          onActivate={(pane) => onOpenFile(file.path, pane)}
          {...rowHandlers}
        >
          <File aria-hidden="true" className="tw-ml-5 tw-size-3.5 tw-shrink-0 tw-text-faint" />
          <span className="tw-min-w-0 tw-shrink tw-truncate" title={file.name}>
            {file.name}
          </span>
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-smaller tw-text-faint">
            {file.folder || "/"}
          </span>
          <FileStatusLabel>{file.change}</FileStatusLabel>
          <span className="tw-shrink-0 tw-text-ui-smaller tw-text-faint">
            {formatRecentAge(file.mtime, now)}
          </span>
        </ProjectRow>
      ))}
    </ProjectFilesSection>
  );
}

export interface LinkedSectionProps extends ProjectTreeHandlers {
  rows: readonly LinkedProjectRow[];
  isDragOver: boolean;
  onAdd: () => void;
  onUnlink: (pattern: string) => void;
}

export function LinkedSection({
  rows,
  isDragOver,
  onAdd,
  onUnlink,
  ...handlers
}: LinkedSectionProps): React.ReactElement {
  return (
    <ProjectFilesSection
      title="Linked"
      action={
        <RowActionButton label="Link a note or folder" onClick={onAdd}>
          <Plus className="tw-size-3.5" />
        </RowActionButton>
      }
    >
      {rows.map((row) => (
        <div
          key={`${row.pattern}\n${row.node.path}`}
          className="tw-group tw-flex tw-min-w-0 tw-items-start"
        >
          <div className="tw-min-w-0 tw-flex-1">
            <ProjectTreeRow
              node={row.node}
              detail={row.missing ? "Not found" : row.parent}
              {...handlers}
            />
          </div>
          <div className="tw-flex tw-shrink-0 tw-py-1 tw-opacity-0 focus-within:tw-opacity-100 group-hover:tw-opacity-100">
            <RowActionButton
              label={`Unlink ${row.node.name}`}
              onClick={() => onUnlink(row.pattern)}
            >
              <X className="tw-size-3.5" />
            </RowActionButton>
          </div>
        </div>
      ))}
      <div
        className={cn(
          "tw-mx-1.5 tw-mt-1 tw-rounded tw-border tw-border-dashed tw-px-2 tw-py-1.5 tw-text-ui-smaller",
          isDragOver
            ? "tw-border-interactive-accent tw-text-accent"
            : "tw-border-border tw-text-faint"
        )}
      >
        {isDragOver
          ? "Drop to link it to this project."
          : `Drop notes or folders here to link them. Files from your computer are copied to ${PROJECT_SOURCES_FOLDER_NAME}/.`}
      </div>
    </ProjectFilesSection>
  );
}

interface ProjectFilesViewProps {
  projectId: string;
}

export function ProjectFilesView({ projectId }: ProjectFilesViewProps): React.ReactElement | null {
  const app = useApp();
  const startNoteDrag = useNoteDrag();
  const configPath = getCachedProjectRecordById(projectId)?.filePath;
  const inclusions = useProjects().find((project) => project.id === projectId)?.contextSource
    ?.inclusions;
  const [expandedPaths, setExpandedPaths] = useState(NO_PATHS);
  const [isDragOver, setIsDragOver] = useState(false);
  const [, refresh] = useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    const refs = [
      app.vault.on("create", refresh),
      app.vault.on("delete", refresh),
      app.vault.on("rename", refresh),
      app.vault.on("modify", refresh),
    ];
    const ageClock = window.setInterval(refresh, AGE_REFRESH_MS);
    return () => {
      window.clearInterval(ageClock);
      for (const ref of refs) app.vault.offref(ref);
    };
  }, [app]);

  if (!configPath) return null;

  const folderPath = getProjectAnchorFromConfigPath(configPath).projectFolderPath;
  const folder = app.vault.getAbstractFileByPath(folderPath);
  const nodes =
    folder instanceof TFolder ? buildProjectTree(folder, expandedPaths, configPath) : EMPTY_TREE;
  const linkedRows = buildLinkedRows(app, inclusions, expandedPaths, configPath);
  const linkedPaths = new Set(linkedRows.filter((row) => !row.missing).map((row) => row.node.path));
  const recentFiles =
    folder instanceof TFolder ? buildRecentFiles(folder, configPath, linkedPaths) : EMPTY_RECENT;

  const toggleFolder = (path: string): void => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  const openFile = (path: string, pane: OpenPane): void => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    openFileInTab(app, file, pane).catch((error: unknown) =>
      logError("[ProjectFilesView] failed to open the file", error)
    );
  };

  const showFileMenu = (path: string, event: React.MouseEvent): void => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) return;
    event.preventDefault();
    const menu = new Menu();
    app.workspace.trigger("file-menu", menu, file, FILE_MENU_SOURCE);
    // The file explorer adds Rename and Delete itself rather than through file-menu, so the tree adds them too;
    // Obsidian's rename prompt only renames files. https://github.com/Brevilabs/obsidian-copilot-private/issues/462
    const prompts = app.fileManager as unknown as FileManagerPrompts;
    const logFailure = (error: unknown) =>
      logError("[ProjectFilesView] file menu action failed", error);
    menu.addSeparator();
    if (file instanceof TFile) {
      menu.addItem((item) =>
        item
          .setTitle("Rename...")
          .setIcon("pencil")
          .onClick(() => prompts.promptForFileRename(file).catch(logFailure))
      );
    }
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash-2")
        .onClick(() => prompts.promptForDeletion(file).catch(logFailure))
    );
    menu.showAtMouseEvent(event.nativeEvent);
  };

  const dragFile = (path: string, event: React.DragEvent): void => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    // The composer attaches only notes, PDFs and images, so other files would be dropped with an
    // "unsupported file" notice. https://github.com/Brevilabs/obsidian-copilot-private/issues/462
    if (!canAttachFileToChat(file)) {
      event.preventDefault();
      return;
    }
    startNoteDrag(event, file);
  };

  const reportFailure = (message: string) => (error: unknown) => {
    logError(`[ProjectFilesView] ${message}`, error);
    new Notice(`Could not ${message}.`);
  };

  const linkItems = (items: readonly TAbstractFile[]): void => {
    // The project folder is already the agent's workspace, so linking its own files would only hide them from Recent.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/461
    const outside = items.filter(
      (item) => item.path !== folderPath && !item.path.startsWith(`${folderPath}/`)
    );
    const linking =
      outside.length > 0 ? linkProjectItems(app, projectId, outside) : Promise.resolve(false);
    linking
      .then((linked) => {
        const names = outside.map((item) => item.name).join(", ");
        new Notice(linked ? `Linked ${names} to the project` : "Already in this project");
      })
      .catch(reportFailure("link to the project"));
  };

  const unlink = (pattern: string): void => {
    unlinkProjectPattern(app, projectId, pattern).catch(reportFailure("unlink from the project"));
  };

  const acceptsDrag = (event: React.DragEvent): boolean =>
    !event.dataTransfer.types.includes(INTERNAL_DRAG_TYPE);

  const dropOnFiles = (event: React.DragEvent): void => {
    if (!acceptsDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const items = getDraggedVaultItems(app);
    if (items.length > 0) return linkItems(items);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    copyIntoProjectSources(app, folderPath, files)
      .then((copies) => {
        const names = copies.map((copy) => copy.name).join(", ");
        new Notice(`Copied ${names} into ${PROJECT_SOURCES_FOLDER_NAME}/`);
      })
      .catch(reportFailure(`copy into ${PROJECT_SOURCES_FOLDER_NAME}/`));
  };

  const rowHandlers = { onOpenFile: openFile, onShowFileMenu: showFileMenu, onDragFile: dragFile };
  return (
    <div
      data-copilot-drop-zone
      className={cn(
        "tw-flex tw-min-h-full tw-flex-1 tw-flex-col tw-rounded-md",
        isDragOver && "tw-bg-interactive-accent-hsl/10 tw-ring-2 tw-ring-inset tw-ring-ring"
      )}
      onDragOver={(event) => {
        if (!acceptsDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!isDragOver) {
          // A drag cancelled with Escape fires no dragleave, so the highlight would stay on until the next drag.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/461
          const endDrag = () => setIsDragOver(false);
          event.currentTarget.ownerDocument.addEventListener("dragend", endDrag, { once: true });
        }
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false);
      }}
      onDrop={dropOnFiles}
    >
      <RecentFilesSection files={recentFiles} now={Date.now()} {...rowHandlers} />
      <ProjectFolderSection
        folderPath={folderPath}
        nodes={nodes}
        onToggleFolder={toggleFolder}
        {...rowHandlers}
      />
      <LinkedSection
        rows={linkedRows}
        isDragOver={isDragOver}
        onAdd={() => new VaultItemSearchModal(app, (item) => linkItems([item])).open()}
        onUnlink={unlink}
        onToggleFolder={toggleFolder}
        {...rowHandlers}
      />
    </div>
  );
}
