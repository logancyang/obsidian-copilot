import { useApp } from "@/context";
import { useNoteDrag } from "@/hooks/useNoteDrag";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById } from "@/projects/state";
import { openFileInTab, openLinkClickProps, type OpenPane } from "@/utils/openVaultPath";
import { ChevronRight, File, Folder } from "lucide-react";
import { Menu, TAbstractFile, TFile, TFolder } from "obsidian";
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

const EMPTY_TREE: readonly ProjectTreeNode[] = Object.freeze([]);
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
}

function ProjectTreeRow({ node, ...handlers }: ProjectTreeRowProps): React.ReactElement {
  const isFolder = node.kind === "folder";
  const expanded = isFolder && node.children !== null;
  const activate = (pane: OpenPane): void => {
    if (isFolder) handlers.onToggleFolder(node.path);
    else handlers.onOpenFile(node.path, pane);
  };
  const Icon = isFolder ? Folder : File;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isFolder ? expanded : undefined}
        draggable={!isFolder}
        className="tw-flex tw-min-w-0 tw-cursor-pointer tw-items-center tw-gap-1.5 tw-rounded tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-normal hover:tw-bg-modifier-hover"
        {...(isFolder
          ? { onClick: () => activate(false) }
          : openLinkClickProps((pane) => activate(pane)))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate(false);
        }}
        onContextMenu={(event) => handlers.onShowFileMenu(node.path, event)}
        onDragStart={isFolder ? undefined : (event) => handlers.onDragFile(node.path, event)}
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
      </div>
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

export function ProjectFolderSection({
  folderPath,
  nodes,
  ...handlers
}: ProjectFolderSectionProps): React.ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="tw-flex tw-min-w-0 tw-flex-col tw-p-1">
      <div className="tw-flex tw-min-w-0 tw-items-baseline tw-gap-2 tw-px-1.5 tw-pb-1 tw-pt-1.5">
        <span
          id={headingId}
          className="tw-shrink-0 tw-text-ui-smaller tw-font-semibold tw-text-faint"
        >
          Project folder
        </span>
        <span
          className="tw-min-w-0 tw-truncate tw-text-ui-smaller tw-text-faint"
          title={folderPath}
        >
          {folderPath}
        </span>
      </div>
      {nodes.length === 0 ? (
        <div className="tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-faint">No files yet.</div>
      ) : (
        <ProjectTreeRows nodes={nodes} {...handlers} />
      )}
    </section>
  );
}

interface ProjectFilesViewProps {
  projectId: string;
}

export function ProjectFilesView({ projectId }: ProjectFilesViewProps): React.ReactElement | null {
  const app = useApp();
  const startNoteDrag = useNoteDrag();
  const configPath = getCachedProjectRecordById(projectId)?.filePath;
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

  return (
    <ProjectFolderSection
      folderPath={folderPath}
      nodes={nodes}
      onToggleFolder={toggleFolder}
      onOpenFile={openFile}
      onShowFileMenu={showFileMenu}
      onDragFile={dragFile}
    />
  );
}
