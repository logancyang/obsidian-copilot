import { ProjectConfig } from "@/aiParams";
import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import { ProjectFileSelectModal } from "@/components/modals/ProjectFileSelectModal";
import { TagSearchModal } from "@/components/modals/TagSearchModal";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderIcon,
  HelpCircle,
  Plus,
  PlusCircle,
  TagIcon,
  XIcon,
} from "lucide-react";
import { App, Modal, Notice, TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";

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

type ActiveSection = "tags" | "folders" | "files" | "extensions" | "ignoreFiles" | "search" | null;
type ActiveItem = string | null;

interface SectionHeaderProps {
  IconComponent: React.ComponentType<any>;
  title: string;
  iconColorClassName: string;
  onAddClick: () => void;
  tooltip?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  IconComponent,
  title,
  iconColorClassName,
  onAddClick,
  tooltip,
}) => {
  return (
    <div className="tw-mb-3 tw-flex tw-items-center tw-justify-between">
      <div className="tw-flex tw-items-center">
        <IconComponent className={`tw-mr-2 tw-size-4 ${iconColorClassName}`} />
        <h3 className={`tw-text-sm tw-font-semibold ${iconColorClassName}`}>{title}</h3>
        {tooltip && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="tw-ml-2 tw-size-4 tw-text-muted" />
              </TooltipTrigger>
              <TooltipContent>
                <div className="tw-max-w-80">{tooltip}</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
  IconComponent: React.ComponentType<any>;
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
}) => {
  return (
    <div>
      <SectionHeader
        IconComponent={IconComponent}
        title={title}
        iconColorClassName={iconColorClassName}
        onAddClick={onAddClick}
        tooltip={tooltip}
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

interface ItemCardProps {
  item: GroupItem;
  viewMode: "list";
  onDelete: (e: React.MouseEvent, item: GroupItem) => void;
}

function ItemCard({ item, viewMode, onDelete }: ItemCardProps) {
  const extension = item.id.split(".").pop() || "";

  // add or remove
  const IconComponent = item.isIgnored ? Plus : XIcon;

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
        <IconComponent
          className="tw-hidden tw-size-4 tw-shrink-0 tw-text-muted hover:tw-text-warning group-hover:tw-block group-hover:tw-flex-none"
          onClick={(e) => onDelete(e, item)}
        />
      </div>
    </div>
  );
}

interface ContextManageProps {
  initialProject: ProjectConfig;
  onSave: (project: ProjectConfig) => void;
  onCancel: () => void;
  app: App;
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
  notes: Array<GroupItem>;
}

interface IgnoreItems {
  files: Set<TFile>;
}

function ContextManage({ initialProject, onSave, onCancel, app }: ContextManageProps) {
  const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = useMemo(() => {
    return getMatchingPatterns({
      inclusions: initialProject?.contextSource.inclusions,
      exclusions: initialProject?.contextSource.exclusions,
      isProject: true,
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
        shouldIndexFile(file, inclusionPatterns, exclusionPatterns)
      );

      const processPatternGroup = (
        file: TFile,
        patterns: string[] | undefined,
        patternType: "tagPatterns" | "folderPatterns" | "extensionPatterns",
        targetGroup: Record<string, Array<GroupItem>>
      ) => {
        if (patterns) {
          patterns.forEach((pattern) => {
            const singlePatternConfig = { [patternType]: [pattern] };
            if (
              shouldIndexFile(file, singlePatternConfig, null) &&
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

        // note/file
        if (
          inclusionPatterns?.notePatterns &&
          shouldIndexFile(file, { notePatterns: inclusionPatterns.notePatterns }, null) &&
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
        notes,
      };
    },
    []
  );

  const [groupList, setGroupList] = useState<GroupListItem>(() => {
    // init include files
    return createAndPopulateGroupList(appAllFiles, inclusionPatterns, exclusionPatterns);
  });
  const [ignoreItems, setIgnoreItems] = useState<IgnoreItems>(() => {
    // init exclude files
    const excludeFiles = appAllFiles.filter(
      (file) => exclusionPatterns && shouldIndexFile(file, exclusionPatterns, null)
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

  //  groupList convert to inclusions format
  const convertGroupListToInclusions = useCallback(
    (list: GroupListItem, appFiles: TFile[]): string => {
      const tagPatterns = Object.keys(list.tags);
      const folderPatterns = Object.keys(list.folders);
      const extensionPatterns = Object.keys(list.extensions);
      const notePatterns = list.notes
        .map((note) => {
          const file = appFiles.find((file) => file.path === note.id);
          if (file) {
            return getFilePattern(file);
          }
        })
        .filter(Boolean) as string[];

      return createPatternSettingsValue({
        tagPatterns,
        folderPatterns,
        extensionPatterns,
        notePatterns,
      });
    },
    []
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

  const getDisplayItems = useMemo(() => {
    if (searchTerm) {
      // Custom search
      const parsedQuery = parseSearchQuery(searchTerm);
      return allItems
        .filter((item) => {
          const fileObj = appAllFiles.find((f) => f.path === item.id);
          if (!fileObj) return false;

          const isNote = fileObj.extension === "md";

          const matchesTag =
            parsedQuery.tags.length > 0 &&
            isNote &&
            parsedQuery.tags.some((queryTag) => {
              const fileTags = getTagsFromNote(fileObj);
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

    if (activeSection === "folders" && activeItem) {
      const folderFiles = groupList.folders[activeItem];
      if (folderFiles) {
        return folderFiles;
      }
      return [];
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

    if (activeSection === "ignoreFiles") {
      return Array.from(ignoreItems.files).map((file) => ({
        id: file.path,
        name: file.basename,
      }));
    }

    return [];
  }, [
    searchTerm,
    activeSection,
    activeItem,
    parseSearchQuery,
    allItems,
    appAllFiles,
    groupList.tags,
    groupList.folders,
    groupList.notes,
    groupList.extensions,
    ignoreItems.files,
  ]);

  const sortItems = useCallback((items: GroupItem[]) => {
    return [...items].sort((a, b) => {
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }, []);

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
      groupType: "tags" | "folders" | "extensions",
      pattern: string,
      patternConfig: PatternCategory
    ) => {
      const getMatchingFilesFromApp = (patterns: PatternCategory): GroupItem[] => {
        return appAllFiles
          .filter((file) => shouldIndexFile(file, patterns, null))
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
    [appAllFiles]
  );

  const removeFileFromGroupList = useCallback(
    (groupList: GroupListItem, filePath: string): GroupListItem => {
      const newGroupList: GroupListItem = {
        tags: { ...groupList.tags },
        folders: { ...groupList.folders },
        extensions: { ...groupList.extensions },
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
      },

      add: {
        tag: () => {
          new TagSearchModal(app, (tagName) => {
            const tagPattern = getTagPattern(tagName);
            addPatternToGroup("tags", tagPattern, { tagPatterns: [tagPattern] });
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

  const getDisplayTitle = () => {
    if (searchTerm) return `Search Results for: "${searchTerm}"`;
    if (activeSection === "tags" && activeItem) {
      return `Tag: ${activeItem}`;
    }
    if (activeSection === "folders" && activeItem) {
      return `Folder: ${activeItem}`;
    }
    if (activeSection === "files") return "Files";
    if (activeSection === "extensions" && activeItem) {
      return `Extension: ${activeItem}`;
    }
    if (activeSection === "ignoreFiles") return "Ignore Files";
    return "Select a category to view items";
  };

  const handleDeleteItem = (e: React.MouseEvent, item: GroupItem) => {
    e.stopPropagation();

    const file = appAllFiles.find((file) => file.path === item.id);
    if (file) {
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
      isProject: true,
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

    const file = appAllFiles.find((file) => file.path === item.id);

    if (file) {
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
      },
    });
  };

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <ResizablePanelGroup direction="horizontal" className="tw-flex-1">
        {/* Left Sidebar - Navigation */}
        <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
          <div className="tw-flex tw-h-full tw-flex-col">
            {/* Header */}
            <div className="tw-border-b tw-p-4">
              <h2 className="tw-text-lg tw-font-semibold">File Context</h2>
            </div>

            <ScrollArea className="tw-max-h-[500px] tw-flex-1">
              <div className="tw-space-y-6 tw-p-4">
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
                    Ignore Files ({ignoreItems.files.size})
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Content Area */}
        <ResizablePanel defaultSize={70}>
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
              {getDisplayItems.length === 0 ? (
                <div className="tw-mt-10 tw-text-center tw-text-muted">
                  {activeSection
                    ? "No items found."
                    : "Select a category from the sidebar to view items."}
                </div>
              ) : (
                <div className="tw-space-y-2" style={{ display: "block" }}>
                  {sortItems(getDisplayItems).map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      viewMode="list"
                      onDelete={
                        activeSection === "ignoreFiles" || item.isIgnored
                          ? handleDeleteIgnoreItem
                          : handleDeleteItem
                      }
                    />
                  ))}
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
    this.root = createRoot(contentEl);

    modalEl.style.minWidth = "50vw";

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
      />
    );
  }

  onClose() {
    if (this.root) {
      this.root.unmount();
    }
  }
}
