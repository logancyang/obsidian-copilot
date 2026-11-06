import { FileStatusLabel } from "@/agentMode/ui/FileChangeSummary";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import { LinkUrlModal } from "@/components/modals/LinkUrlModal";
import { ProjectFileSelectModal } from "@/components/modals/ProjectFileSelectModal";
import { PropertySearchModal } from "@/components/modals/PropertySearchModal";
import { TagSearchModal } from "@/components/modals/TagSearchModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context";
import { canAttachFileToChat } from "@/hooks/useChatFileDrop";
import { INTERNAL_DRAG_TYPE, useNoteDrag } from "@/hooks/useNoteDrag";
import { parseProjectUrls, type UrlItem } from "@/lib/url-tag";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { PROJECT_SOURCES_FOLDER_NAME } from "@/projects/constants";
import {
  copyIntoProjectSources,
  getDraggedVaultItems,
  linkProjectItems,
  linkProjectPattern,
  linkProjectUrl,
  unlinkProjectPattern,
  unlinkProjectUrl,
} from "@/projects/projectLinks";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import {
  categorizePatterns,
  getDecodedPatterns,
  getNotesWithProperty,
  getNotesWithTag,
  getPropertyLabel,
  getTagPattern,
} from "@/search/searchUtils";
import { openFileInTab, openLinkClickProps, type OpenPane } from "@/utils/openVaultPath";
import {
  ChevronRight,
  File,
  Folder,
  Globe,
  Link,
  type LucideIcon,
  Plus,
  SlidersHorizontal,
  SquarePlay,
  Tag,
  X,
} from "lucide-react";
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

interface LinkedMatchNote {
  node: ProjectTreeNode;
  parent: string;
}

export interface LinkedMatchRow {
  kind: "tag" | "property";
  pattern: string;
  label: string;
  count: number;
  notes: readonly LinkedMatchNote[] | null;
}

export type LinkKind = "files" | "folders" | "tags" | "properties" | "link";

const LINK_KINDS: readonly { kind: LinkKind; label: string; icon: LucideIcon }[] = [
  { kind: "files", label: "Files", icon: File },
  { kind: "folders", label: "Folders", icon: Folder },
  { kind: "tags", label: "Tags", icon: Tag },
  { kind: "properties", label: "Properties", icon: SlidersHorizontal },
  { kind: "link", label: "Link", icon: Link },
];

export const FILES_DROP_HIGHLIGHT =
  "tw-bg-interactive-accent-hsl/10 tw-ring-2 tw-ring-inset tw-ring-ring";

const EMPTY_TREE: readonly ProjectTreeNode[] = Object.freeze([]);
const EMPTY_LINKED: readonly LinkedProjectRow[] = Object.freeze([]);
const EMPTY_MATCHES: readonly LinkedMatchRow[] = Object.freeze([]);
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

export function buildLinkedMatchRows(
  app: App,
  inclusions: string | undefined,
  expandedPaths: ReadonlySet<string>
): readonly LinkedMatchRow[] {
  const { tagPatterns, propertyPatterns } = categorizePatterns([
    ...new Set(getDecodedPatterns(inclusions ?? "")),
  ]);
  if (tagPatterns.length + propertyPatterns.length === 0) return EMPTY_MATCHES;
  const row = (
    kind: LinkedMatchRow["kind"],
    pattern: string,
    label: string,
    files: TFile[]
  ): LinkedMatchRow => ({
    kind,
    pattern,
    label,
    count: files.length,
    notes: expandedPaths.has(pattern)
      ? files.map((file) => ({
          node: { kind: "file", path: file.path, name: file.name },
          parent: parentPath(file.path),
        }))
      : null,
  });
  return [
    ...tagPatterns.map((tag) => row("tag", tag, tag, getNotesWithTag(app, tag))),
    ...propertyPatterns.map((pattern) =>
      row("property", pattern, getPropertyLabel(pattern), getNotesWithProperty(app, pattern))
    ),
  ];
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

interface ProjectRowProps extends Partial<
  Pick<ProjectTreeHandlers, "onShowFileMenu" | "onDragFile">
> {
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
  const startDrag = isFolder ? undefined : onDragFile;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      draggable={startDrag !== undefined}
      className="tw-flex tw-min-w-0 tw-cursor-pointer tw-items-center tw-gap-1.5 tw-rounded tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-normal hover:tw-bg-modifier-hover"
      {...(isFolder ? { onClick: () => onActivate(false) } : openLinkClickProps(onActivate))}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate(false);
      }}
      onContextMenu={onShowFileMenu && ((event) => onShowFileMenu(path, event))}
      onDragStart={startDrag && ((event) => startDrag(path, event))}
    >
      {children}
    </div>
  );
}

interface RowLabelProps {
  icon: LucideIcon;
  name: string;
  title?: string;
  detail?: string;
  expanded?: boolean;
}

function RowLabel({
  icon: Icon,
  name,
  title = name,
  detail,
  expanded,
}: RowLabelProps): React.ReactElement {
  return (
    <>
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "tw-size-3.5 tw-shrink-0 tw-text-faint",
          expanded === undefined && "tw-invisible",
          expanded && "tw-rotate-90"
        )}
      />
      <Icon aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-faint" />
      <span className="tw-min-w-0 tw-truncate" title={title}>
        {name}
      </span>
      {detail && (
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-smaller tw-text-faint">
          {detail}
        </span>
      )}
    </>
  );
}

function RowGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="tw-ml-3 tw-border-0 tw-border-l tw-border-solid tw-border-border tw-pl-1"
    >
      {children}
    </div>
  );
}

function ProjectTreeRow({ node, detail, ...handlers }: ProjectTreeRowProps): React.ReactElement {
  const isFolder = node.kind === "folder";
  const expanded = isFolder ? node.children !== null : undefined;

  return (
    <>
      <ProjectRow
        path={node.path}
        expanded={expanded}
        onActivate={(pane) =>
          isFolder ? handlers.onToggleFolder(node.path) : handlers.onOpenFile(node.path, pane)
        }
        onShowFileMenu={handlers.onShowFileMenu}
        onDragFile={handlers.onDragFile}
      >
        <RowLabel
          icon={isFolder ? Folder : File}
          name={node.name}
          detail={detail}
          expanded={expanded}
        />
      </ProjectRow>
      {isFolder && node.children !== null && node.children.length > 0 && (
        <RowGroup label={node.name}>
          <ProjectTreeRows nodes={node.children} {...handlers} />
        </RowGroup>
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

export function ProjectFilesSection({
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

export interface FileDetailRowProps extends Omit<ProjectRowProps, "expanded"> {
  name: string;
  folder: string;
  status: string;
}

export function FileDetailRow({
  name,
  folder,
  status,
  children,
  ...rowProps
}: FileDetailRowProps): React.ReactElement {
  return (
    <ProjectRow {...rowProps}>
      <File aria-hidden="true" className="tw-ml-5 tw-size-3.5 tw-shrink-0 tw-text-faint" />
      <span className="tw-min-w-0 tw-shrink tw-truncate" title={name}>
        {name}
      </span>
      <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-smaller tw-text-faint">
        {folder || "/"}
      </span>
      <FileStatusLabel>{status}</FileStatusLabel>
      {children}
    </ProjectRow>
  );
}

export interface LinkedSectionProps extends ProjectTreeHandlers {
  rows: readonly LinkedProjectRow[];
  matches: readonly LinkedMatchRow[];
  urls: readonly UrlItem[];
  onLink: (kind: LinkKind) => void;
  onUnlink: (pattern: string) => void;
  onOpenUrl: (url: string) => void;
  onUnlinkUrl: (item: UrlItem) => void;
}

interface UnlinkableRowProps {
  name: string;
  onUnlink: () => void;
  children: React.ReactNode;
}

function UnlinkableRow({ name, onUnlink, children }: UnlinkableRowProps): React.ReactElement {
  return (
    <div className="tw-group tw-flex tw-min-w-0 tw-items-start">
      <div className="tw-min-w-0 tw-flex-1">{children}</div>
      <div className="tw-flex tw-shrink-0 tw-py-1 tw-opacity-0 focus-within:tw-opacity-100 group-hover:tw-opacity-100">
        <RowActionButton label={`Unlink ${name}`} onClick={onUnlink}>
          <X className="tw-size-3.5" />
        </RowActionButton>
      </div>
    </div>
  );
}

function LinkContextMenu({ onLink }: Pick<LinkedSectionProps, "onLink">): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost2" size="fit" className="tw-text-ui-smaller">
          <Plus className="tw-size-3.5" />
          Link context
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
  matches,
  urls,
  onLink,
  onUnlink,
  onOpenUrl,
  onUnlinkUrl,
  ...handlers
}: LinkedSectionProps): React.ReactElement {
  return (
    <ProjectFilesSection title="Linked" action={<LinkContextMenu onLink={onLink} />}>
      {rows.length + matches.length + urls.length === 0 && (
        <div className="tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-faint">Nothing linked yet.</div>
      )}
      {rows.map((row) => (
        <UnlinkableRow
          key={`${row.pattern}\n${row.node.path}`}
          name={row.node.name}
          onUnlink={() => onUnlink(row.pattern)}
        >
          <ProjectTreeRow
            node={row.node}
            detail={row.missing ? "Not found" : row.parent}
            {...handlers}
          />
        </UnlinkableRow>
      ))}
      {matches.map((row) => (
        <UnlinkableRow key={row.pattern} name={row.label} onUnlink={() => onUnlink(row.pattern)}>
          <ProjectRow
            path={row.pattern}
            expanded={row.notes !== null}
            onActivate={() => handlers.onToggleFolder(row.pattern)}
          >
            <RowLabel
              icon={row.kind === "tag" ? Tag : SlidersHorizontal}
              name={row.label}
              detail={`${row.count} ${row.count === 1 ? "note" : "notes"}`}
              expanded={row.notes !== null}
            />
          </ProjectRow>
          {row.notes !== null && row.notes.length > 0 && (
            <RowGroup label={row.label}>
              {row.notes.map((note) => (
                <ProjectTreeRow
                  key={note.node.path}
                  node={note.node}
                  detail={note.parent}
                  {...handlers}
                />
              ))}
            </RowGroup>
          )}
        </UnlinkableRow>
      ))}
      {urls.map((item) => {
        const address = item.url.replace(/^https?:\/\//, "");
        return (
          <UnlinkableRow key={item.id} name={address} onUnlink={() => onUnlinkUrl(item)}>
            <ProjectRow path={item.url} onActivate={() => onOpenUrl(item.url)}>
              <RowLabel
                icon={item.type === "youtube" ? SquarePlay : Globe}
                name={address}
                title={item.url}
              />
            </ProjectRow>
          </UnlinkableRow>
        );
      })}
    </ProjectFilesSection>
  );
}

interface ProjectFilesViewProps {
  projectId: string;
  acceptsDrops?: boolean;
}

export function ProjectFilesView({
  projectId,
  acceptsDrops = false,
}: ProjectFilesViewProps): React.ReactElement | null {
  const app = useApp();
  const startNoteDrag = useNoteDrag();
  const configPath = getCachedProjectRecordById(projectId)?.filePath;
  const contextSource = useProjects().find((project) => project.id === projectId)?.contextSource;
  const inclusions = contextSource?.inclusions;
  const [expandedPaths, setExpandedPaths] = useState(NO_EXPANDED_FOLDERS);
  const [isDragOver, setIsDragOver] = useState(false);
  const [, refresh] = useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    const refs = [
      app.vault.on("create", refresh),
      app.vault.on("delete", refresh),
      app.vault.on("rename", refresh),
    ];
    // A note's tags change only once Obsidian re-reads it, after the vault's modify event, so tag rows follow the metadata cache.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/838
    const metadataRefs = [
      app.metadataCache.on("changed", refresh),
      app.metadataCache.on("resolved", refresh),
    ];
    return () => {
      for (const ref of refs) app.vault.offref(ref);
      for (const ref of metadataRefs) app.metadataCache.offref(ref);
    };
  }, [app]);

  if (!configPath) return null;

  const folderPath = getProjectAnchorFromConfigPath(configPath).projectFolderPath;
  const folder = app.vault.getAbstractFileByPath(folderPath);
  const nodes =
    folder instanceof TFolder ? buildProjectTree(folder, expandedPaths, configPath) : EMPTY_TREE;
  const linkedRows = buildLinkedRows(app, inclusions, expandedPaths, configPath);
  const matchRows = buildLinkedMatchRows(app, inclusions, expandedPaths);
  const urls = parseProjectUrls(contextSource?.webUrls ?? "", contextSource?.youtubeUrls ?? "");

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

  const announceLink = (linking: Promise<boolean>, names: string): void => {
    linking
      .then((linked) => {
        new Notice(linked ? `Linked ${names} to the project` : "Already in this project");
      })
      .catch(reportFailure("link to the project"));
  };

  const linkItems = (items: readonly TAbstractFile[]): void => {
    // The project folder is already the agent's workspace, so linking its own files would only list them twice.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/461
    const outside = items.filter(
      (item) => item.path !== folderPath && !item.path.startsWith(`${folderPath}/`)
    );
    announceLink(
      outside.length > 0 ? linkProjectItems(app, projectId, outside) : Promise.resolve(false),
      outside.map((item) => item.name).join(", ")
    );
  };

  const linkPattern = (pattern: string, name = pattern): void =>
    announceLink(linkProjectPattern(app, projectId, pattern), name);

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
    tags: () => new TagSearchModal(app, (tag) => linkPattern(getTagPattern(tag))).open(),
    properties: () =>
      new PropertySearchModal(app, (pattern) =>
        linkPattern(pattern, getPropertyLabel(pattern))
      ).open(),
    link: () =>
      new LinkUrlModal(app, (item) =>
        announceLink(linkProjectUrl(app, projectId, item), item.url)
      ).open(),
  };

  const unlink = (pattern: string): void => {
    unlinkProjectPattern(app, projectId, pattern).catch(reportFailure("unlink from the project"));
  };

  const unlinkUrl = (item: UrlItem): void => {
    unlinkProjectUrl(app, projectId, item).catch(reportFailure("unlink from the project"));
  };

  // Drops link or copy only on the project home; in a chat's popover they looked too busy and aren't needed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/839
  const acceptsDrag = (event: React.DragEvent): boolean =>
    acceptsDrops && !event.dataTransfer.types.includes(INTERNAL_DRAG_TYPE);

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
      data-copilot-drop-zone={acceptsDrops || undefined}
      className={cn(
        "tw-flex tw-min-h-full tw-flex-1 tw-flex-col tw-rounded-md",
        isDragOver && FILES_DROP_HIGHLIGHT
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
      <ProjectFolderSection
        folderPath={folderPath}
        nodes={nodes}
        onToggleFolder={toggleFolder}
        {...rowHandlers}
      />
      <LinkedSection
        rows={linkedRows}
        matches={matchRows}
        urls={urls}
        onLink={(kind) => pickToLink[kind]()}
        onUnlink={unlink}
        onOpenUrl={(url) => window.open(url, "_blank")}
        onUnlinkUrl={unlinkUrl}
        onToggleFolder={toggleFolder}
        {...rowHandlers}
      />
    </div>
  );
}
