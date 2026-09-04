import { ProjectConfig } from "@/aiParams";
import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import {
  buildProcessingItemLookup,
  ProcessingStatusIcon,
  processingSourceKey,
} from "@/components/project/processingItemStatusView";
import { useAgentProcessingItems } from "@/components/project/useAgentProcessingItems";
import { openAgentCachedItemPreview } from "@/utils/cacheFileOpener";
import { ProjectFileSelectModal } from "@/components/modals/ProjectFileSelectModal";
import { PropertySearchModal } from "@/components/modals/PropertySearchModal";
import { TagSearchModal } from "@/components/modals/TagSearchModal";
import { getBadgeLabel } from "@/components/project/ProjectContextBadgeList";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  createPatternSettingsValue,
  getFilePattern,
  getMatchingPatterns,
  getTagPattern,
  PatternCategory,
  shouldIndexFile,
} from "@/search/searchUtils";
import { getTagsFromNote } from "@/utils";
import {
  ArrowUpRight,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderIcon,
  Plus,
  PlusCircle,
  SlidersHorizontal,
  TagIcon,
  XIcon,
} from "lucide-react";
import { App, Modal, Notice, Platform, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Root } from "react-dom/client";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import {
  LinksContentPanel,
  LinksSidebarSection,
} from "@/components/modals/project/ContextManageLinksPanel";
import { useContextUrls } from "@/components/modals/project/useContextUrls";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";

function FileIcon({ extension, size = "tw-size-4" }: { extension: string; size?: string }) {
  const ext = extension.toLowerCase().replace("*.", "");
  if (["jpg", "jpeg", "png", "gif", "svg"].includes(ext))
    return <FileImage className={`tw-text-context-manager-blue ${size}`} />;
  if (["mp3", "wav", "ogg"].includes(ext))
    return <FileAudio className={`tw-text-context-manager-purple ${size}`} />;
  if (["mp4", "mov", "avi"].includes(ext))
    return <FileVideo className={`tw-text-context-manager-orange ${size}`} />;
  if (["md", "txt", "mdx", "markdown"].includes(ext)) return <FileText className={`${size}`} />;

  return <FileText className={`tw-text-faint ${size}`} />;
}

interface ParsedQuery {
  tags: string[];
  titles: string[];
  extensions: string[];
}

type ActiveSection =
  | "tags"
  | "folders"
  | "files"
  | "extensions"
  | "properties"
  | "ignoreFiles"
  | "search"
  | "links"
  | "web"
  | "youtube"
  | null;
type ActiveItem = string | null;

interface SectionHeaderProps {
  IconComponent: React.ComponentType<{ className?: string }>;
  title: string;
  iconColorClassName: string;
  onAddClick: () => void;
  tooltip?: string;
  /** When provided, the title (icon + label) is clickable — lists the whole
   * category on the right (agent Links variant). Omitted for CAG → not clickable. */
  onTitleClick?: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  IconComponent,
  title,
  iconColorClassName,
  onAddClick,
  tooltip,
  onTitleClick,
}) => {
  return (
    <div className="tw-mb-3 tw-flex tw-items-center tw-justify-between">
      <div
        className={cn(
          "tw-flex tw-items-center",
          onTitleClick &&
            "tw-cursor-pointer tw-rounded-md tw-px-1 tw-py-0.5 hover:tw-bg-secondary/50"
        )}
        onClick={onTitleClick}
      >
        <IconComponent className={`tw-mr-2 tw-size-4 ${iconColorClassName}`} />
        <h3 className={`tw-text-sm tw-font-semibold ${iconColorClassName}`}>{title}</h3>
        {tooltip && (
          // Stop the tooltip click from bubbling to the (agent-clickable) title.
          <span onClick={(e) => e.stopPropagation()}>
            <HelpTooltip
              buttonClassName="tw-ml-2 tw-size-4 tw-text-muted"
              content={<div className="tw-max-w-80">{tooltip}</div>}
            />
          </span>
        )}
      </div>

      <Button
        variant="ghost"
        size="fit"
        className="tw-text-muted hover:tw-bg-secondary"
        title={`Add new ${title.toLowerCase()}`}
        onClick={onAddClick}
      >
        <PlusCircle className={`tw-size-4 ${iconColorClassName}`} />
      </Button>
    </div>
  );
};

interface SectionItem {
  id: string;
  name: string;
  count?: number;
}

interface SectionListProps {
  title: string;
  IconComponent: React.ComponentType<{ className?: string }>;
  iconColorClassName: string;
  items: SectionItem[];
  activeItem: string | null;
  activeSection: string | null;
  sectionType: string;
  renderIcon?: (item: SectionItem) => React.ReactNode;
  onItemClick: (itemId: string, itemName?: string) => void;
  onAddClick: () => void;
  onDeleteItem: (e: React.MouseEvent, item: SectionItem) => void;
  tooltip?: string;
  /** Forwarded to the header's title click (agent Links variant). */
  onSectionClick?: () => void;
}

const SectionList: React.FC<SectionListProps> = ({
  title,
  IconComponent,
  iconColorClassName,
  items,
  activeItem,
  activeSection,
  sectionType,
  renderIcon,
  onItemClick,
  onAddClick,
  onDeleteItem,
  tooltip,
  onSectionClick,
}) => {
  return (
    <div>
      <SectionHeader
        IconComponent={IconComponent}
        title={title}
        iconColorClassName={iconColorClassName}
        onAddClick={onAddClick}
        tooltip={tooltip}
        onTitleClick={onSectionClick}
      />
      <div className="tw-space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "tw-group tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-rounded-md tw-p-2 hover:tw-bg-secondary/50",
              activeSection === sectionType &&
                activeItem === item.id &&
                "tw-bg-secondary tw-text-normal"
            )}
            onClick={() => onItemClick(item.id, item.name)}
          >
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center">
              {renderIcon ? (
                renderIcon(item)
              ) : (
                <IconComponent className={`tw-mr-2 tw-size-4 ${iconColorClassName}`} />
              )}
              <TruncatedText className="tw-flex-1 tw-text-sm">{item.name}</TruncatedText>
            </div>
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-xs tw-text-muted group-hover:tw-hidden">
                {item.count || 0}
              </span>
              <XIcon
                className="tw-hidden tw-size-4 tw-shrink-0 tw-text-muted hover:tw-text-warning group-hover:tw-block group-hover:tw-flex-none"
                onClick={(e) => onDeleteItem(e, item)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Project Context Load Status Types and Utilities
// ============================================================================

// ============================================================================
// ItemCard Component
// ============================================================================

interface ItemCardProps {
  item: GroupItem;
  viewMode: "list";
  /** Per-file conversion status from the agent pipeline, rendered via the
   * shared {@link ProcessingStatusIcon}. */
  agentProcessingItem?: ProcessingItem;
  onDelete: (e: React.MouseEvent, item: GroupItem) => void;
  /** Optional: callback to open the cached parsed content for this file. */
  onOpenCached?: () => void;
}

function ItemCard({ item, viewMode, agentProcessingItem, onDelete, onOpenCached }: ItemCardProps) {
  const extension = item.id.split(".").pop() || "";

  // add or remove
  const IconComponent = item.isIgnored ? Plus : XIcon;

  // "View parsed content" arrow, revealed on row hover once the source has a
  // converted snapshot.
  const previewButton =
    onOpenCached && agentProcessingItem?.status === "ready" ? (
      <Button
        variant="ghost2"
        size="icon"
        className="tw-hidden tw-size-5 group-hover:tw-block"
        onClick={(e) => {
          e.stopPropagation();
          onOpenCached();
        }}
        title="View Parsed Content"
      >
        <ArrowUpRight className="tw-size-4" />
      </Button>
    ) : null;

  return (
    <div className="tw-group tw-flex tw-cursor-pointer tw-items-center tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-2 tw-transition-shadow hover:tw-shadow-md">
      <div className="tw-mr-2 tw-shrink-0">
        <FileIcon extension={extension} size={"tw-size-8"} />
      </div>
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
        <TruncatedText className="tw-flex-1 tw-text-sm tw-font-medium">
          {item.isIgnored && <span className="tw-text-sm tw-text-error"> (Ignored files)</span>}
          {item.name}
        </TruncatedText>
        {item.id && (
          <TruncatedText className="tw-flex-1 tw-text-xs tw-text-faint">{item.id}</TruncatedText>
        )}
      </div>

      <div className="tw-ml-auto tw-flex tw-min-w-[24px] tw-items-center tw-justify-end tw-gap-2">
        {/* Order is [preview][status][delete]; the status is a bare icon (ready
            hidden until row hover), error revealed on hover. */}
        {previewButton}
        {agentProcessingItem && (
          <ProcessingStatusIcon item={agentProcessingItem} revealReadyOnHover />
        )}
        <IconComponent
          className="tw-hidden tw-size-4 tw-shrink-0 tw-text-muted hover:tw-text-warning group-hover:tw-block group-hover:tw-flex-none"
          onClick={(e) => onDelete(e, item)}
        />
      </div>
    </div>
  );
}

/**
 * DESIGN NOTE — this modal's property visual states (the icon below, the
 * Properties section, its value rows) have no component-gallery story, unlike
 * the sibling editors ProjectContextBadgeList and ProjectContextSourceEditor.
 * A story can only mount an exported component, and this file exports just the
 * Obsidian `Modal` subclass; every React part here is module-private. Covering
 * it would mean exporting `ContextManage` solely so the gallery can reach it,
 * which no story in this repo does — the widened production surface costs more
 * than the coverage buys, since the property icon and hue are identical to the
 * two components that are covered. If a future review flags this again, point
 * them at this note.
 */
function CategoryItemCard({
  item,
  onClick,
}: {
  item: CategoryItem;
  onClick: (item: CategoryItem) => void;
}) {
  let IconComponent;
  let iconColorClassName;

  switch (item.type) {
    case "tag":
      IconComponent = TagIcon;
      iconColorClassName = "tw-text-context-manager-orange";
      break;
    case "property":
      IconComponent = SlidersHorizontal;
      iconColorClassName = "tw-text-context-manager-purple";
      break;
    case "folder":
      IconComponent = FolderIcon;
      iconColorClassName = "tw-text-context-manager-yellow";
      break;
    case "files":
      IconComponent = FileText;
      iconColorClassName = "tw-text-context-manager-blue";
      break;
    case "ignoreFiles":
      IconComponent = XIcon;
      iconColorClassName = "tw-text-context-manager-red";
      break;
  }

  return (
    <div
      className="tw-group tw-flex tw-cursor-pointer tw-items-center tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-2 tw-transition-shadow hover:tw-shadow-md"
      onClick={() => onClick(item)}
    >
      <div className="tw-mr-2 tw-shrink-0">
        {item.type === "web" || item.type === "youtube" ? (
          // Reuse the canonical URL glyph so the card matches every other URL
          // surface (Links sidebar, +URL popover, context chips).
          <UrlTypeIcon type={item.type} className="tw-size-6" />
        ) : (
          IconComponent && <IconComponent className={`tw-size-6 ${iconColorClassName}`} />
        )}
      </div>
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
        <TruncatedText className="tw-flex-1 tw-text-sm tw-font-medium">
          {item.type === "tag" && <span className="tw-mr-2 tw-text-faint">#</span>}
          {item.name}
        </TruncatedText>
        <TruncatedText className="tw-flex-1 tw-text-xs tw-text-faint">
          {item.count} {item.count === 1 ? "item" : "items"}
        </TruncatedText>
      </div>
    </div>
  );
}

interface ContextManageProps {
  initialProject: ProjectConfig;
  onSave: (project: ProjectConfig) => void;
  onCancel: () => void;
  app: App;
  /** Agent Mode: show the Links (Web/YouTube) section and persist URL edits.
   * Off for CAG callers, leaving this modal's file-only behavior unchanged. */
  /** Portal target for the Links +URL popover — the modal's own `contentEl`, so
   * the popover (layer 30) stacks above this modal (layer 50). */
  popoverContainer?: HTMLElement | null;
}

interface GroupItem {
  id: string;
  name: string;
  isIgnored?: boolean;
}

interface GroupListItem {
  tags: Record<string, Array<GroupItem>>;
  folders: Record<string, Array<GroupItem>>;
  extensions: Record<string, Array<GroupItem>>;
  properties: Record<string, Array<GroupItem>>;
  notes: Array<GroupItem>;
}

interface IgnoreItems {
  files: Set<TFile>;
}

interface CategoryItem {
  id: string;
  name: string;
  type: "tag" | "folder" | "files" | "property" | "ignoreFiles" | "web" | "youtube";
  originalId?: string;
  count: number;
}

type DisplayItem = GroupItem | CategoryItem;

function isCategoryItem(item: DisplayItem): item is CategoryItem {
  return "type" in item;
}

function ContextManage({
  initialProject,
  onSave,
  onCancel,
  app,
  popoverContainer,
}: ContextManageProps) {
  const isMobile = Platform.isMobile;
  const contextUrls = useContextUrls(initialProject);
  // One shared conversion-status lookup keyed by `processingSourceKey`,
  // covering both URL rows and File Context rows so they render the same
  // {@link ProcessingStatusIcon}.
  const { items: agentProcessingItems } = useAgentProcessingItems(
    app,
    initialProject,
    initialProject.contextSource
  );
  const agentProcessingByKey = useMemo(
    () => buildProcessingItemLookup(agentProcessingItems),
    [agentProcessingItems]
  );

  const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = useMemo(() => {
    return getMatchingPatterns({
      inclusions: initialProject?.contextSource.inclusions,
      exclusions: initialProject?.contextSource.exclusions,
    });
  }, [initialProject.contextSource]);

  const appAllFiles = useMemo(() => {
    return app.vault.getFiles();
  }, [app.vault]);

  // init groupList
  const createAndPopulateGroupList = useCallback(
    (
      appFiles: TFile[],
      inclusionPatterns: PatternCategory | null,
      exclusionPatterns: PatternCategory | null
    ): GroupListItem => {
      const projectAllFiles = appFiles.filter((file) =>
        shouldIndexFile(app, file, inclusionPatterns, exclusionPatterns, true)
      );

      const processPatternGroup = (
        file: TFile,
        patterns: string[] | undefined,
        patternType: "tagPatterns" | "folderPatterns" | "extensionPatterns" | "propertyPatterns",
        targetGroup: Record<string, Array<GroupItem>>
      ) => {
        if (patterns) {
          patterns.forEach((pattern) => {
            const singlePatternConfig = { [patternType]: [pattern] };
            if (
              shouldIndexFile(app, file, singlePatternConfig, null, true) &&
              !targetGroup[pattern].some((item) => item.id === file.path)
            ) {
              targetGroup[pattern].push({
                id: file.path,
                name: file.basename,
              });
            }
          });
        }
      };

      // initialize groups
      const tags: Record<string, Array<GroupItem>> = {};
      const folders: Record<string, Array<GroupItem>> = {};
      const extensions: Record<string, Array<GroupItem>> = {};
      const properties: Record<string, Array<GroupItem>> = {};
      const notes: Array<GroupItem> = [];

      (inclusionPatterns?.tagPatterns ?? []).forEach((tag) => {
        tags[tag] = [];
      });
      (inclusionPatterns?.folderPatterns ?? []).forEach((folder) => {
        folders[folder] = [];
      });
      (inclusionPatterns?.extensionPatterns ?? []).forEach((extension) => {
        extensions[extension] = [];
      });
      (inclusionPatterns?.propertyPatterns ?? []).forEach((property) => {
        properties[property] = [];
      });

      // Traverse the files and populate them into corresponding groups
      projectAllFiles.forEach((file) => {
        // tag
        processPatternGroup(file, inclusionPatterns?.tagPatterns, "tagPatterns", tags);

        // folder
        processPatternGroup(file, inclusionPatterns?.folderPatterns, "folderPatterns", folders);

        // extension
        processPatternGroup(
          file,
          inclusionPatterns?.extensionPatterns,
          "extensionPatterns",
          extensions
        );

        // property
        processPatternGroup(
          file,
          inclusionPatterns?.propertyPatterns,
          "propertyPatterns",
          properties
        );

        // note/file
        if (
          inclusionPatterns?.notePatterns &&
          shouldIndexFile(
            app,
            file,
            { notePatterns: inclusionPatterns.notePatterns },
            null,
            true
          ) &&
          !notes.some((item) => item.id === file.path)
        ) {
          notes.push({
            id: file.path,
            name: file.basename,
          });
        }
      });

      return {
        tags,
        folders,
        extensions,
        properties,
        notes,
      };
    },
    [app]
  );

  const [groupList, setGroupList] = useState<GroupListItem>(() => {
    // init include files
    return createAndPopulateGroupList(appAllFiles, inclusionPatterns, exclusionPatterns);
  });
  const [ignoreItems, setIgnoreItems] = useState<IgnoreItems>(() => {
    // init exclude files
    const excludeFiles = appAllFiles.filter(
      (file) => exclusionPatterns && shouldIndexFile(app, file, exclusionPatterns, null, true)
    );
    return {
      files: new Set<TFile>(excludeFiles),
    };
  });

  const latestGroupList = useRef(groupList);
  const latestIgnoreItems = useRef(ignoreItems);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const isLinksActive =
    activeSection === "links" || activeSection === "web" || activeSection === "youtube";

  // A file row's status + snapshot-preview, resolved in ONE place so the JSX
  // doesn't branch per prop. Ignored rows get neither.
  const getFileRowStatusProps = useCallback(
    (item: GroupItem): Pick<ItemCardProps, "agentProcessingItem" | "onOpenCached"> => {
      if (item.isIgnored || activeSection === "ignoreFiles") return {};
      const agentItem = agentProcessingByKey.get(processingSourceKey("file", item.id));
      return {
        agentProcessingItem: agentItem,
        onOpenCached: agentItem ? () => void openAgentCachedItemPreview(app, agentItem) : undefined,
      };
    },
    [activeSection, agentProcessingByKey, app]
  );

  //  groupList convert to inclusions format
  const convertGroupListToInclusions = useCallback(
    (list: GroupListItem, appFiles: TFile[]): string => {
      const tagPatterns = Object.keys(list.tags);
      const folderPatterns = Object.keys(list.folders);
      const extensionPatterns = Object.keys(list.extensions);
      const propertyPatterns = Object.keys(list.properties);
      const notePatterns = list.notes
        .map((note) => {
          const file = app.vault.getAbstractFileByPath(note.id);
          if (file instanceof TFile) {
            return getFilePattern(file);
          }
        })
        .filter(Boolean) as string[];

      return createPatternSettingsValue({
        tagPatterns,
        folderPatterns,
        extensionPatterns,
        propertyPatterns,
        notePatterns,
      });
    },
    [app.vault]
  );

  // ignore file items convert to exclusions format
  const convertDeletedItemsToExclusions = useCallback((items: IgnoreItems): string => {
    const notePatterns = new Array(...items.files).map((file) => getFilePattern(file));

    return createPatternSettingsValue({ notePatterns: notePatterns }) || "";
  }, []);

  useEffect(() => {
    latestGroupList.current = groupList;
    latestIgnoreItems.current = ignoreItems;
  }, [groupList, ignoreItems]);

  const allItems: Array<{ id: string; name: string }> = useMemo(() => {
    const items: Array<{ id: string; name: string }> = [];

    const addFilesToItems = (
      items: Array<{ id: string; name: string }>,
      groupItems: GroupItem[]
    ): void => {
      groupItems.forEach((groupItem) => {
        if (!items.some((item) => item.id === groupItem.id)) {
          items.push({
            id: groupItem.id,
            name: groupItem.name,
          });
        }
      });
    };

    const arr = [
      groupList.tags,
      groupList.folders,
      groupList.extensions,
      groupList.properties,
      { notes: groupList.notes },
    ];

    arr.forEach((item) => {
      Object.values(item).forEach((groupItems) => {
        addFilesToItems(items, groupItems);
      });
    });

    return items;
  }, [groupList]);

  const parseSearchQuery = useCallback((query: string): ParsedQuery => {
    const tags: string[] = [];
    const titles: string[] = [];
    const extensions: string[] = [];

    const parts = query
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);

    parts.forEach((part) => {
      if (part.startsWith("#")) {
        // tag
        tags.push(part.substring(1));
      } else if (part.startsWith(".") || part.startsWith("*.")) {
        extensions.push(part.replace("*", ""));
      } else {
        // All other content is matched as title.
        titles.push(part);
      }
    });
    return { tags, titles, extensions };
  }, []);

  const sortItems = useCallback((items: DisplayItem[]) => {
    return [...items].sort((a, b) => {
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }, []);

  const getDisplayItems = useMemo<DisplayItem[]>(() => {
    if (searchTerm) {
      // Custom search
      const parsedQuery = parseSearchQuery(searchTerm);
      return allItems
        .filter((item) => {
          const fileObj = app.vault.getAbstractFileByPath(item.id);
          if (!(fileObj instanceof TFile)) return false;

          const isNote = fileObj.extension === "md";

          const matchesTag =
            parsedQuery.tags.length > 0 &&
            isNote &&
            parsedQuery.tags.some((queryTag) => {
              const fileTags = getTagsFromNote(app, fileObj);
              return fileTags.some((tag) => {
                const cleanTag = tag.startsWith("#") ? tag.substring(1) : tag;
                return cleanTag.toLowerCase().includes(queryTag.toLowerCase());
              });
            });

          const matchesTitle =
            parsedQuery.titles.length > 0 &&
            parsedQuery.titles.some((t) =>
              fileObj.basename.toLowerCase().includes(t.toLowerCase())
            );

          const matchesExtension =
            parsedQuery.extensions.length > 0 &&
            parsedQuery.extensions.some(
              (ext) => `.${fileObj.extension}`.toLowerCase() === ext.toLowerCase()
            );

          const hasSpecificFilters =
            parsedQuery.tags.length > 0 ||
            parsedQuery.titles.length > 0 ||
            parsedQuery.extensions.length > 0;

          if (hasSpecificFilters) {
            return matchesTag || matchesTitle || matchesExtension;
          }
          return false;
        })
        .map((item) => {
          return {
            id: item.id,
            name: item.name,
          };
        });
    }

    if (activeSection === "tags" && activeItem) {
      const tagFiles = groupList.tags[activeItem];
      if (tagFiles) {
        return tagFiles;
      }
      return [];
    }

    // Clicking the Tags header (agent Links variant) lists every tag. CAG never
    // reaches this state — its header isn't clickable — so behavior is unchanged.
    if (activeSection === "tags") {
      return sortItems(
        Object.entries(groupList.tags).map(([tagId, files]) => ({
          id: `tag:${tagId}`,
          name: tagId.slice(1),
          type: "tag",
          originalId: tagId,
          count: files.length,
        }))
      );
    }

    if (activeSection === "folders" && activeItem) {
      const folderFiles = groupList.folders[activeItem];
      if (folderFiles) {
        return folderFiles;
      }
      return [];
    }

    // Clicking the Folders header (agent Links variant) lists every folder.
    if (activeSection === "folders") {
      return sortItems(
        Object.entries(groupList.folders).map(([folderId, files]) => ({
          id: `folder:${folderId}`,
          name: folderId,
          type: "folder",
          originalId: folderId,
          count: files.length,
        }))
      );
    }

    if (activeSection === "files") {
      return groupList.notes;
    }

    if (activeSection === "extensions" && activeItem) {
      const extensionFiles = groupList.extensions[activeItem];
      if (extensionFiles) {
        return extensionFiles;
      }
      return [];
    }

    if (activeSection === "properties" && activeItem) {
      const propertyFiles = groupList.properties[activeItem];
      if (propertyFiles) {
        return propertyFiles;
      }
      return [];
    }

    // Clicking the Properties header (agent Links variant) lists every property.
    if (activeSection === "properties") {
      return sortItems(
        Object.entries(groupList.properties).map(([propertyId, files]) => ({
          id: `property:${propertyId}`,
          name: getBadgeLabel({ pattern: propertyId, type: "property" }),
          type: "property",
          originalId: propertyId,
          count: files.length,
        }))
      );
    }

    if (activeSection === "ignoreFiles") {
      return Array.from(ignoreItems.files).map((file) => ({
        id: file.path,
        name: file.basename,
      }));
    }

    // When no part is selected, return all items
    if (!activeSection) {
      const tagItems = sortItems(
        Object.entries(groupList.tags).map(([tagId, files]) => ({
          id: `tag:${tagId}`,
          name: tagId.slice(1),
          type: "tag",
          originalId: tagId,
          count: files.length,
        }))
      );

      const folderItems = sortItems(
        Object.entries(groupList.folders).map(([folderId, files]) => ({
          id: `folder:${folderId}`,
          name: folderId,
          type: "folder",
          originalId: folderId,
          count: files.length,
        }))
      );

      const propertyItems = sortItems(
        Object.entries(groupList.properties).map(([propertyId, files]) => ({
          id: `property:${propertyId}`,
          name: getBadgeLabel({ pattern: propertyId, type: "property" }),
          type: "property",
          originalId: propertyId,
          count: files.length,
        }))
      );

      const filesItem =
        groupList.notes.length > 0
          ? [
              {
                id: "files:all",
                name: "Files",
                type: "files",
                count: groupList.notes.length,
              },
            ]
          : [];

      const ignoreFilesItem =
        ignoreItems.files.size > 0
          ? [
              {
                id: "ignoreFiles:all",
                name: "Ignore Files",
                type: "ignoreFiles",
                count: ignoreItems.files.size,
              },
            ]
          : [];

      // List Web and YouTube as their own cards so the overview surfaces every
      // context type the same way (one card per non-empty group, exactly like
      // folders). Leads the grid to mirror the sidebar, where Links sits first.
      const webCount = contextUrls.urlItems.filter((u) => u.type === "web").length;
      const youtubeCount = contextUrls.urlItems.filter((u) => u.type === "youtube").length;
      const linkItems = [
        ...(webCount > 0 ? [{ id: "web:all", name: "Web", type: "web", count: webCount }] : []),
        ...(youtubeCount > 0
          ? [{ id: "youtube:all", name: "YouTube", type: "youtube", count: youtubeCount }]
          : []),
      ];

      return [
        ...linkItems,
        ...tagItems,
        ...propertyItems,
        ...folderItems,
        ...filesItem,
        ...ignoreFilesItem,
      ];
    }

    return [];
  }, [
    app,
    searchTerm,
    activeSection,
    activeItem,
    parseSearchQuery,
    allItems,
    groupList.tags,
    groupList.folders,
    groupList.notes,
    groupList.extensions,
    groupList.properties,
    ignoreItems.files,
    sortItems,
    contextUrls.urlItems,
  ]);

  const makeSectionItem = useCallback(
    (
      groupData: Record<string, Array<GroupItem>>,
      nameTransform?: (name: string) => string
    ): SectionItem[] => {
      return Object.entries(groupData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([itemName, itemFiles]) => ({
          id: itemName,
          name: nameTransform ? nameTransform(itemName) : itemName,
          count: itemFiles.length,
        }));
    },
    []
  );

  const addPatternToGroup = useCallback(
    (
      groupType: "tags" | "folders" | "extensions" | "properties",
      pattern: string,
      patternConfig: PatternCategory
    ) => {
      const getMatchingFilesFromApp = (patterns: PatternCategory): GroupItem[] => {
        return appAllFiles
          .filter((file) => shouldIndexFile(app, file, patterns, null, true))
          .map((file) => ({
            id: file.path,
            name: file.basename,
          }));
      };

      const ignoreFiles = [...latestIgnoreItems.current.files];
      const matchingFiles: GroupItem[] = getMatchingFilesFromApp(patternConfig).map((v) => ({
        ...v,
        // add flag if file is ignored
        isIgnored: ignoreFiles.some((f) => f.path === v.id),
      }));

      setGroupList((prev) => ({
        ...prev,
        [groupType]: {
          ...prev[groupType],
          [pattern]: matchingFiles,
        },
      }));
    },
    [app, appAllFiles]
  );

  const removeFileFromGroupList = useCallback(
    (groupList: GroupListItem, filePath: string): GroupListItem => {
      const newGroupList: GroupListItem = {
        tags: { ...groupList.tags },
        folders: { ...groupList.folders },
        extensions: { ...groupList.extensions },
        properties: { ...groupList.properties },
        notes: [...groupList.notes],
      };

      const removeFileFromGroupObject = (groupObject: Record<string, Array<GroupItem>>) => {
        Object.keys(groupObject).forEach((key) => {
          groupObject[key] = groupObject[key].filter((item) => item.id !== filePath);
        });
      };

      removeFileFromGroupObject(newGroupList.tags);
      removeFileFromGroupObject(newGroupList.folders);
      removeFileFromGroupObject(newGroupList.extensions);
      removeFileFromGroupObject(newGroupList.properties);

      // Remove file from notes
      newGroupList.notes = newGroupList.notes.filter((item) => item.id !== filePath);

      return newGroupList;
    },
    []
  );

  const setActiveState = useCallback(
    (section: ActiveSection, item: ActiveItem = null, clearSearch: boolean = true) => {
      setActiveSection(section);
      setActiveItem(item);
      if (clearSearch) {
        setSearchTerm("");
      }
    },
    []
  );

  // Unified processor
  const groupHandlers = useMemo(() => {
    const createDeleteHandler = (groupType: keyof Omit<GroupListItem, "notes">) => {
      return (e: React.MouseEvent, item: SectionItem) => {
        e.stopPropagation();

        setGroupList((prev) => {
          const newGroup = { ...prev[groupType] };
          delete newGroup[item.id];
          return {
            ...prev,
            [groupType]: newGroup,
          };
        });
      };
    };

    return {
      delete: {
        tag: createDeleteHandler("tags"),
        folder: createDeleteHandler("folders"),
        extension: createDeleteHandler("extensions"),
        property: createDeleteHandler("properties"),
      },

      add: {
        tag: () => {
          new TagSearchModal(app, (tagName) => {
            const tagPattern = getTagPattern(tagName);
            addPatternToGroup("tags", tagPattern, { tagPatterns: [tagPattern] });
          }).open();
        },

        property: () => {
          // The modal builds the `[key:value]` pattern from real vault data; add it
          // straight to the group keyed by that pattern (mirrors the tag flow).
          new PropertySearchModal(app, (propertyPattern) => {
            addPatternToGroup("properties", propertyPattern, {
              propertyPatterns: [propertyPattern],
            });
          }).open();
        },

        folder: () => {
          new FolderSearchModal(app, (folderPath) => {
            addPatternToGroup("folders", folderPath, { folderPatterns: [folderPath] });
          }).open();
        },

        file: () => {
          new ProjectFileSelectModal({
            app,
            onFileSelect: (file: TFile) => {
              const existingNote = groupList.notes.find((note) => note.id === file.path);
              if (existingNote) return;

              // remove file from ignore
              setIgnoreItems((prev) => {
                const newFiles = new Set(prev.files);
                newFiles.delete(file);
                return { ...prev, files: newFiles };
              });

              setGroupList((prev) => ({
                ...prev,
                notes: [...prev.notes, { id: file.path, name: file.basename }],
              }));
            },
            excludeFilePaths: [],
            titleOnly: false,
          }).open();
        },

        extension: () => {
          // todo(emt-lin)：maybe use this in the future
          new Notice("Adding extension is temporarily not supported.");
          return;
          /*new ExtensionInputModal(app, (extension: string) => {
            if (extension.trim() === "") return;
            const extensionPattern = getExtensionPattern(extension);
            addPatternToGroup("extensions", extensionPattern, {
              extensionPatterns: [extensionPattern],
            });
          }).open();*/
        },

        ignoreFile: () => {
          new ProjectFileSelectModal({
            app,
            onFileSelect: (file: TFile) => {
              const isAlreadyIgnored = ignoreItems.files.has(file);
              if (isAlreadyIgnored) return;

              setIgnoreItems((prev) => {
                const newFiles = new Set(prev.files);
                newFiles.add(file);
                return { ...prev, files: newFiles };
              });

              // Remove related files from the groupList
              setGroupList((prev) => removeFileFromGroupList(prev, file.path));
            },
            excludeFilePaths: [],
            titleOnly: false,
          }).open();
        },
      },

      click: {
        tag: (tagId: string) => {
          setActiveState("tags", tagId);
        },

        property: (propertyId: string) => {
          setActiveState("properties", propertyId);
        },

        folder: (folderId: string) => {
          setActiveState("folders", folderId);
        },

        extension: (extension: string) => {
          setActiveState("extensions", extension);
        },

        files: () => {
          setActiveState("files");
        },

        ignoreFiles: () => {
          setActiveState("ignoreFiles");
        },
      },
    };
  }, [
    app,
    groupList.notes,
    ignoreItems.files,
    addPatternToGroup,
    removeFileFromGroupList,
    setActiveState,
  ]);

  const handleCategoryItemClick = useCallback(
    (item: CategoryItem) => {
      if (item.type === "tag" && item.originalId) {
        groupHandlers.click.tag(item.originalId);
      } else if (item.type === "property" && item.originalId) {
        groupHandlers.click.property(item.originalId);
      } else if (item.type === "folder" && item.originalId) {
        groupHandlers.click.folder(item.originalId);
      } else if (item.type === "files") {
        groupHandlers.click.files();
      } else if (item.type === "ignoreFiles") {
        groupHandlers.click.ignoreFiles();
      } else if (item.type === "web" || item.type === "youtube") {
        setActiveState(item.type);
      }
    },
    [groupHandlers, setActiveState]
  );

  const getDisplayTitle = () => {
    if (searchTerm) return `Search Results for: "${searchTerm}"`;
    if (activeSection === "links") return "Links";
    if (activeSection === "web") return "Web";
    if (activeSection === "youtube") return "YouTube";
    if (activeSection === "tags" && activeItem) {
      return `Tag: ${activeItem}`;
    }
    if (activeSection === "tags") return "Tags";
    if (activeSection === "properties" && activeItem) {
      return `Property: ${getBadgeLabel({ pattern: activeItem, type: "property" })}`;
    }
    if (activeSection === "properties") return "Properties";
    if (activeSection === "folders" && activeItem) {
      return `Folder: ${activeItem}`;
    }
    if (activeSection === "folders") return "Folders";
    if (activeSection === "files") return "Files";
    if (activeSection === "extensions" && activeItem) {
      return `Extension: ${activeItem}`;
    }
    if (activeSection === "ignoreFiles") return "Ignore Files";
    return "All Categories";
  };

  // Agent Links variant: clicking the Tags/Folders header lists that category's
  // entries on the right. Those are CategoryItems, so the right pane must use the
  // category-card branch (not the file ItemCard branch) for these states.
  const showingCategoryItems =
    !searchTerm &&
    !activeItem &&
    (activeSection === "tags" || activeSection === "folders" || activeSection === "properties");

  const handleDeleteItem = (e: React.MouseEvent, item: GroupItem) => {
    e.stopPropagation();

    const file = app.vault.getAbstractFileByPath(item.id);
    if (file instanceof TFile) {
      // add file to ignore
      setIgnoreItems((prev) => {
        const newFiles = new Set(prev.files);
        newFiles.add(file);
        return { ...prev, files: newFiles };
      });

      setGroupList((prev) => removeFileFromGroupList(prev, item.id));
    }
  };

  const refreshGroupListFromCurrentPatterns = useCallback(() => {
    const currentInclude = convertGroupListToInclusions(latestGroupList.current, appAllFiles);
    const currentExclude = convertDeletedItemsToExclusions(latestIgnoreItems.current);

    const { inclusions, exclusions } = getMatchingPatterns({
      inclusions: currentInclude,
      exclusions: currentExclude,
    });

    const newGroupList = createAndPopulateGroupList(appAllFiles, inclusions, exclusions);
    setGroupList(newGroupList);
  }, [
    appAllFiles,
    convertDeletedItemsToExclusions,
    convertGroupListToInclusions,
    createAndPopulateGroupList,
  ]);

  const handleDeleteIgnoreItem = (e: React.MouseEvent, item: GroupItem) => {
    e.stopPropagation();

    const file = app.vault.getAbstractFileByPath(item.id);

    if (file instanceof TFile) {
      setIgnoreItems((prev) => {
        const newFiles = new Set(prev.files);
        newFiles.delete(file);
        return { ...prev, files: newFiles };
      });

      // refresh groupList
      refreshGroupListFromCurrentPatterns();
    }
  };

  const handleSave = () => {
    const include = convertGroupListToInclusions(groupList, appAllFiles);
    const exclude = convertDeletedItemsToExclusions(ignoreItems);
    onSave({
      ...initialProject,
      contextSource: {
        ...initialProject.contextSource,
        inclusions: include,
        exclusions: exclude,
        // Agent Mode only: persist URL edits back. CAG callers don't enable
        // Links, so their save payload is byte-for-byte unchanged.
        webUrls: contextUrls.webUrls,
        youtubeUrls: contextUrls.youtubeUrls,
      },
    });
  };

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <ResizablePanelGroup direction="horizontal" className="tw-flex-1">
        {/* Left Sidebar - Navigation */}
        <ResizablePanel defaultSize={isMobile ? 35 : 30} minSize={20} maxSize={40}>
          <div className="tw-flex tw-h-full tw-flex-col">
            {/* Header */}
            <div className="tw-border-b tw-p-4">
              <h2 className="tw-text-lg tw-font-semibold">File Context</h2>
            </div>

            <ScrollArea className="tw-max-h-[500px] tw-flex-1">
              <div className="tw-space-y-6 tw-p-4">
                {/* Links first: URLs are the most-used source in projects, so
                    the section leads the navigation. */}
                <LinksSidebarSection
                  activeSection={activeSection}
                  webCount={contextUrls.urlItems.filter((u) => u.type === "web").length}
                  youtubeCount={contextUrls.urlItems.filter((u) => u.type === "youtube").length}
                  onSelect={(s) => setActiveState(s)}
                  existingUrls={contextUrls.urlItems.map((u) => u.url)}
                  onAddUrls={(items) => contextUrls.addFromText(items.map((i) => i.url).join("\n"))}
                  popoverContainer={popoverContainer}
                />
                <Separator />

                {/* Tags Section */}
                <SectionList
                  title="Tags"
                  IconComponent={TagIcon}
                  iconColorClassName="tw-text-context-manager-orange"
                  items={makeSectionItem(groupList.tags, (name) => name.slice(1))}
                  activeItem={activeItem}
                  activeSection={activeSection}
                  sectionType="tags"
                  renderIcon={(_item) => <span className="tw-mr-2 tw-text-faint">#</span>}
                  onItemClick={groupHandlers.click.tag}
                  onAddClick={groupHandlers.add.tag}
                  onDeleteItem={(e, item) => groupHandlers.delete.tag(e, item)}
                  tooltip="must be in note property"
                  onSectionClick={() => setActiveState("tags", null)}
                />

                <Separator />

                {/* Properties Section — includes notes by a frontmatter property
                    (e.g. Topics: Physics), the taxonomy some vaults use instead of tags. */}
                <SectionList
                  title="Properties"
                  IconComponent={SlidersHorizontal}
                  iconColorClassName="tw-text-context-manager-purple"
                  items={makeSectionItem(groupList.properties, (pattern) =>
                    getBadgeLabel({ pattern, type: "property" })
                  )}
                  activeItem={activeItem}
                  activeSection={activeSection}
                  sectionType="properties"
                  onItemClick={groupHandlers.click.property}
                  onAddClick={groupHandlers.add.property}
                  onDeleteItem={(e, item) => groupHandlers.delete.property(e, item)}
                  tooltip="Include notes by a frontmatter property, e.g. Topics: Physics"
                  onSectionClick={() => setActiveState("properties", null)}
                />

                <Separator />

                {/* Folders Section */}
                <SectionList
                  title="Folders"
                  IconComponent={FolderIcon}
                  iconColorClassName="tw-text-context-manager-yellow"
                  items={makeSectionItem(groupList.folders)}
                  activeItem={activeItem}
                  activeSection={activeSection}
                  sectionType="folders"
                  onItemClick={groupHandlers.click.folder}
                  onAddClick={groupHandlers.add.folder}
                  onDeleteItem={(e, item) => groupHandlers.delete.folder(e, item)}
                  onSectionClick={() => setActiveState("folders", null)}
                />

                <Separator />

                {/* Files Section */}
                <div>
                  <SectionHeader
                    IconComponent={FileText}
                    title="Files"
                    iconColorClassName="tw-text-context-manager-blue"
                    onAddClick={groupHandlers.add.file}
                  />
                  <div
                    className={cn(
                      "tw-cursor-pointer tw-rounded-md tw-p-2 tw-text-sm hover:tw-bg-secondary/50",
                      activeSection === "files" && "tw-bg-secondary tw-text-normal"
                    )}
                    onClick={groupHandlers.click.files}
                  >
                    Files ({groupList.notes.length})
                  </div>
                </div>

                <Separator />

                {/* todo(emt-lin)：maybe use this in the future */}
                {/* Extensions Section */}
                {/*<SectionList
                  title="Extensions"
                  IconComponent={Hash}
                  iconColorClassName="tw-text-context-manager-green"
                  items={makeSectionItem(groupList.extensions)}
                  activeItem={activeItem}
                  activeSection={activeSection}
                  sectionType="extensions"
                  renderIcon={(item) => <FileIcon extension={item.name} />}
                  onItemClick={groupHandlers.click.extension}
                  onAddClick={groupHandlers.add.extension}
                  onDeleteItem={(e, item) => groupHandlers.delete.extension(e, item)}
                />

                <Separator />*/}

                {/* Ignore Files Section */}
                <div>
                  <SectionHeader
                    IconComponent={XIcon}
                    title="Ignore Files"
                    iconColorClassName="tw-text-context-manager-red"
                    onAddClick={groupHandlers.add.ignoreFile}
                  />
                  <div
                    className={cn(
                      "tw-cursor-pointer tw-rounded-md tw-p-2 tw-text-sm hover:tw-bg-secondary/50",
                      activeSection === "ignoreFiles" && "tw-bg-secondary tw-text-normal"
                    )}
                    onClick={groupHandlers.click.ignoreFiles}
                  >
                    Files ({ignoreItems.files.size})
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Content Area */}
        <ResizablePanel defaultSize={isMobile ? 65 : 70}>
          <div className="tw-flex tw-h-full tw-flex-col">
            {/* Header */}
            <div className="tw-border-b tw-p-4">
              <SearchBar
                placeholder="Custom search: title, #tag1, .jpg"
                value={searchTerm}
                onChange={(v) => {
                  setSearchTerm(v);
                  if (v) {
                    setActiveState("search", null, false);
                  }
                }}
              />
            </div>

            {/* Content Title */}
            <div className="tw-p-4">
              <h3 className="tw-text-lg tw-font-medium tw-text-muted">{getDisplayTitle()}</h3>
            </div>

            {/* Content Area */}
            <ScrollArea className="tw-max-h-[400px] tw-flex-1 tw-p-4 tw-pt-0">
              {isLinksActive ? (
                <LinksContentPanel
                  app={app}
                  urlItems={contextUrls.urlItems}
                  filter={activeSection}
                  agentProcessingByKey={agentProcessingByKey}
                  onRemove={contextUrls.removeUrl}
                />
              ) : getDisplayItems.length === 0 ? (
                <div className="tw-mt-10 tw-text-center tw-text-muted">
                  {activeSection
                    ? "No items found."
                    : "No categories found. Add tags, folders, or files using the sidebar."}
                </div>
              ) : (
                <div className="tw-space-y-2" style={{ display: "block" }}>
                  {activeSection || searchTerm
                    ? // When a category is selected or a search is performed, display the normal item list.
                      sortItems(getDisplayItems)
                        .map((item) => {
                          if (showingCategoryItems && isCategoryItem(item)) {
                            return (
                              <CategoryItemCard
                                key={item.id}
                                item={item}
                                onClick={handleCategoryItemClick}
                              />
                            );
                          }
                          if (isCategoryItem(item)) return null;
                          return (
                            <ItemCard
                              key={item.id}
                              item={item}
                              viewMode="list"
                              onDelete={
                                activeSection === "ignoreFiles" || item.isIgnored
                                  ? handleDeleteIgnoreItem
                                  : handleDeleteItem
                              }
                              {...getFileRowStatusProps(item)}
                            />
                          );
                        })
                        .filter(Boolean)
                    : // When no category is selected and no search, display the grouped category list.
                      getDisplayItems
                        .map((item) =>
                          isCategoryItem(item) ? (
                            <CategoryItemCard
                              key={item.id}
                              item={item}
                              onClick={handleCategoryItemClick}
                            />
                          ) : null
                        )
                        .filter(Boolean)}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <div className="tw-flex tw-justify-end tw-gap-2 tw-border-t tw-p-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
}

export class ContextManageModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onSave: (project: ProjectConfig) => void,
    private initialProject: ProjectConfig
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    modalEl.addClass("tw-min-w-[50vw]");

    const handleSave = (project: ProjectConfig) => {
      this.onSave(project);
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <ContextManage
        initialProject={this.initialProject}
        onSave={handleSave}
        onCancel={handleCancel}
        app={this.app}
        popoverContainer={contentEl}
      />
    );
  }

  onClose() {
    if (this.root) {
      this.root.unmount();
    }
  }
}
