import { AgentHomePreviewList } from "@/agentMode/ui/AgentHomeSection";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import { ProjectFileSelectModal } from "@/projects/ui/ProjectFileSelectModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context";
import { useNoteDrag } from "@/hooks/useNoteDrag";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import {
  getProjectLinks,
  linkProjectItems,
  type ProjectLinks,
  unlinkProjectPattern,
} from "@/projects/projectLinks";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import { openFileInTab, openLinkClickProps, type OpenPane } from "@/utils/openVaultPath";
import { ChevronRight, File, Folder, type LucideIcon, Plus, X } from "lucide-react";
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

export interface LinkedProjectRow {
  pattern: string;
  node: ProjectTreeNode;
  parent: string;
  missing: boolean;
}

export type LinkKind = "files" | "folders";

const LINK_KINDS: readonly { kind: LinkKind; label: string; icon: LucideIcon }[] = [
  { kind: "files", label: "Files", icon: File },
  { kind: "folders", label: "Folders", icon: Folder },
];

const EMPTY_TREE: readonly ProjectTreeNode[] = Object.freeze([]);
const EMPTY_LINKED: readonly LinkedProjectRow[] = Object.freeze([]);
const NO_EXPANDED_FOLDERS: ReadonlySet<string> = new Set();
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

function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

export function buildLinkedRows(
  app: App,
  links: ProjectLinks,
  expandedPaths: ReadonlySet<string>,
  configPath: string
): readonly LinkedProjectRow[] {
  if (links.folders.length + links.notes.length === 0) return EMPTY_LINKED;
  const folderRows = links.folders.map((pattern): LinkedProjectRow => {
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
  const files = links.notes.length > 0 ? app.vault.getFiles() : [];
  const noteRows = links.notes.flatMap((pattern): LinkedProjectRow[] => {
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
  children: React.ReactNode;
}

function ProjectFilesSection({
  title,
  detail,
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

export interface LinkedSectionProps extends ProjectTreeHandlers {
  rows: readonly LinkedProjectRow[];
  onUnlink: (pattern: string) => void;
}

export interface ProjectFilesPanelProps {
  onLink: (kind: LinkKind) => void;
  children: React.ReactNode;
}

export function ProjectFilesPanel({
  onLink,
  children,
}: ProjectFilesPanelProps): React.ReactElement {
  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-2">
      <AgentHomePreviewList>{children}</AgentHomePreviewList>
      <LinkContextMenu onLink={onLink} />
    </div>
  );
}

function LinkContextMenu({ onLink }: Pick<ProjectFilesPanelProps, "onLink">): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost2"
          size="sm"
          className="tw-mt-1 tw-w-full tw-shrink-0 tw-text-muted"
        >
          <Plus className="tw-size-3" aria-hidden="true" />
          Link context
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {LINK_KINDS.map(({ kind, label, icon: Icon }) => (
          <DropdownMenuItem key={kind} onSelect={() => onLink(kind)}>
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LinkedSection({
  rows,
  onUnlink,
  ...handlers
}: LinkedSectionProps): React.ReactElement {
  return (
    <ProjectFilesSection title="Linked">
      {rows.length === 0 && (
        <div className="tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-faint">Nothing linked yet.</div>
      )}
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
  const links = getProjectLinks(useProjects().find((project) => project.id === projectId));
  const [expandedPaths, setExpandedPaths] = useState(NO_EXPANDED_FOLDERS);
  const [, refresh] = useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    const refs = [
      app.vault.on("create", refresh),
      app.vault.on("delete", refresh),
      app.vault.on("rename", refresh),
    ];
    return () => {
      for (const ref of refs) app.vault.offref(ref);
    };
  }, [app]);

  if (!configPath) return null;

  const folderPath = getProjectAnchorFromConfigPath(configPath).projectFolderPath;
  const folder = app.vault.getAbstractFileByPath(folderPath);
  const nodes =
    folder instanceof TFolder ? buildProjectTree(folder, expandedPaths, configPath) : EMPTY_TREE;
  const linkedRows = buildLinkedRows(app, links, expandedPaths, configPath);

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
    startNoteDrag(event, file);
  };

  const reportFailure = (message: string) => (error: unknown) => {
    logError(`[ProjectFilesView] ${message}`, error);
    new Notice(`Could not ${message}.`);
  };

  const linkItems = (items: readonly TAbstractFile[]): void => {
    // The project folder is already the agent's workspace, so linking its own files would only list them twice.
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

  const pickToLink: Record<LinkKind, () => void> = {
    files: () =>
      new ProjectFileSelectModal({
        app,
        onFileSelect: (file) => linkItems([file]),
        excludeFilePaths: [],
      }).open(),
    folders: () =>
      new FolderSearchModal(app, (path) => {
        const folder = app.vault.getAbstractFileByPath(path);
        if (folder instanceof TFolder) linkItems([folder]);
      }).open(),
  };

  const unlink = (pattern: string): void => {
    unlinkProjectPattern(app, projectId, pattern).catch(reportFailure("unlink from the project"));
  };

  const rowHandlers = { onOpenFile: openFile, onShowFileMenu: showFileMenu, onDragFile: dragFile };
  return (
    <ProjectFilesPanel onLink={(kind) => pickToLink[kind]()}>
      <ProjectFolderSection
        folderPath={folderPath}
        nodes={nodes}
        onToggleFolder={toggleFolder}
        {...rowHandlers}
      />
      <LinkedSection
        rows={linkedRows}
        onUnlink={unlink}
        onToggleFolder={toggleFolder}
        {...rowHandlers}
      />
    </ProjectFilesPanel>
  );
}
