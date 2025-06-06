/*
import React, { useCallback, useMemo, useState } from "react";
import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderIcon,
  Hash,
  PlusCircle,
  Search,
  TagIcon,
  XIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  type FileItem,
  type Folder,
  type Item,
  mockFiles,
  mockFolders,
  mockNotes,
  mockTags,
  type Note,
  type TagData,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const getFileIcon = (extension: string) => {
  const ext = extension.toLowerCase().replace(".", "");
  if (["jpg", "jpeg", "png", "gif", "svg"].includes(ext))
    return <FileImage className="tw-text-blue-500 tw-size-4" />;
  if (["mp3", "wav", "ogg"].includes(ext))
    return <FileAudio className="tw-text-purple-500 tw-size-4" />;
  if (["mp4", "mov", "avi"].includes(ext))
    return <FileVideo className="tw-text-orange-500 tw-size-4" />;
  if (["js", "ts", "tsx", "py", "java", "c", "cpp", "html", "css"].includes(ext))
    return <FileCode className="tw-text-green-500 tw-size-4" />;
  if (["zip", "rar", "tar", "gz"].includes(ext))
    return <FileArchive className="tw-text-yellow-500 tw-size-4" />;
  return <FileText className="tw-text-gray-500 tw-size-4" />;
};

interface ParsedQuery {
  paths: string[];
  tags: string[];
  titles: string[];
  extensions: string[];
  generalTexts: string[];
}

type ActiveSection = "tags" | "folders" | "files" | "extensions" | "search" | null;
type ActiveItem = string | null;

export function ContextManage() {
  const [folders, setFolders] = useState<Folder[]>(mockFolders);
  const [notes, setNotes] = useState<Note[]>(mockNotes);
  const [files, setFiles] = useState<FileItem[]>(mockFiles);
  const [tagsData, setTagsData] = useState<TagData[]>(mockTags);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);
  const [activeItem, setActiveItem] = useState<ActiveItem>(null);
  const [sortKey, setSortKey] = useState<"name" | "date" | "type">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const allItems: Item[] = useMemo(() => [...folders, ...notes, ...files], [folders, notes, files]);

  // Calculate counts for each category
  const tagNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    tagsData.forEach((tag) => {
      counts[tag.id] = notes.filter((note) => note.tags.includes(tag.id)).length;
    });
    return counts;
  }, [notes, tagsData]);

  const folderItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    folders.forEach((folder) => {
      counts[folder.id] = allItems.filter((item) => item.parentId === folder.id).length;
    });
    return counts;
  }, [allItems, folders]);

  const extensionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    files.forEach((file) => {
      const ext = file.extension;
      counts[ext] = (counts[ext] || 0) + 1;
    });
    return counts;
  }, [files]);

  const uniqueExtensions = useMemo(() => {
    return Object.keys(extensionCounts).sort();
  }, [extensionCounts]);

  const parseSearchQuery = (query: string): ParsedQuery => {
    const paths: string[] = [];
    const tags: string[] = [];
    const titles: string[] = [];
    const extensions: string[] = [];
    const generalTexts: string[] = [];

    const parts = query
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);

    parts.forEach((part) => {
      if (part.startsWith("#")) {
        tags.push(part.substring(1));
      } else if (part.startsWith("[[")) {
        const titleMatch = part.match(/^\[\[(.*?)\]\]$/);
        if (titleMatch) titles.push(titleMatch[1]);
        else generalTexts.push(part);
      } else if (part.startsWith(".") || part.startsWith("*.")) {
        extensions.push(part.replace("*", ""));
      } else if (part.includes("/")) {
        paths.push(part);
      } else {
        const isFolderName = folders.some((f) => f.name.toLowerCase() === part.toLowerCase());
        if (isFolderName) {
          paths.push(part);
        } else {
          generalTexts.push(part);
        }
      }
    });
    return { paths, tags, titles, extensions, generalTexts };
  };

  const getItemPath = useCallback(
    (itemId: string, currentPath = ""): string => {
      const item = allItems.find((i) => i.id === itemId);
      if (!item) return currentPath;
      const pathPart = item.type === "note" ? (item as Note).title : item.name;
      const newPath = currentPath ? `${pathPart}/${currentPath}` : pathPart;
      if (item.parentId) {
        return getItemPath(item.parentId, newPath);
      }
      return newPath.split("/").reverse().join("/");
    },
    [allItems]
  );

  const getDisplayItems = useMemo(() => {
    if (searchTerm) {
      // Custom search
      const parsedQuery = parseSearchQuery(searchTerm);
      return allItems.filter((item) => {
        const itemPath = getItemPath(item.id);
        const itemName =
          item.type === "note" ? (item as Note).title.toLowerCase() : item.name.toLowerCase();

        const matchesPath =
          parsedQuery.paths.length > 0 &&
          parsedQuery.paths.some((p) => itemPath.toLowerCase().includes(p.toLowerCase()));
        const matchesTag =
          parsedQuery.tags.length > 0 &&
          item.type === "note" &&
          (item as Note).tags.some((tagId) => {
            const tag = tagsData.find((t) => t.id === tagId);
            return (
              tag &&
              parsedQuery.tags.some((qt) => tag.name.toLowerCase().includes(qt.toLowerCase()))
            );
          });
        const matchesTitle =
          parsedQuery.titles.length > 0 &&
          item.type === "note" &&
          parsedQuery.titles.some((t) =>
            (item as Note).title.toLowerCase().includes(t.toLowerCase())
          );
        const matchesExtension =
          parsedQuery.extensions.length > 0 &&
          item.type === "file" &&
          parsedQuery.extensions.some(
            (ext) => (item as FileItem).extension.toLowerCase() === ext.toLowerCase()
          );
        const matchesGeneralText =
          parsedQuery.generalTexts.length > 0 &&
          parsedQuery.generalTexts.some(
            (gt) =>
              itemName.includes(gt.toLowerCase()) ||
              (item.type === "note" &&
                (item as Note).contentPreview?.toLowerCase().includes(gt.toLowerCase())) ||
              itemPath.toLowerCase().includes(gt.toLowerCase())
          );

        const hasSpecificFilters =
          parsedQuery.paths.length > 0 ||
          parsedQuery.tags.length > 0 ||
          parsedQuery.titles.length > 0 ||
          parsedQuery.extensions.length > 0;

        if (hasSpecificFilters) {
          return (
            matchesPath || matchesTag || matchesTitle || matchesExtension || matchesGeneralText
          );
        } else if (parsedQuery.generalTexts.length > 0) {
          return matchesGeneralText;
        }
        return false;
      });
    }

    if (activeSection === "tags" && activeItem) {
      return notes.filter((note) => note.tags.includes(activeItem));
    }

    if (activeSection === "folders" && activeItem) {
      return allItems.filter((item) => item.parentId === activeItem);
    }

    if (activeSection === "files") {
      return files;
    }

    if (activeSection === "extensions" && activeItem) {
      return files.filter((file) => file.extension === activeItem);
    }

    return [];
  }, [
    searchTerm,
    activeSection,
    activeItem,
    allItems,
    notes,
    files,
    tagsData,
    folders,
    getItemPath,
  ]);

  const sortItems = useCallback(
    (items: Item[]) => {
      return [...items].sort((a, b) => {
        let valA: string | number;
        let valB: string | number;

        switch (sortKey) {
          case "name":
            valA = (a.type === "note" ? (a as Note).title : a.name).toLowerCase();
            valB = (b.type === "note" ? (b as Note).title : b.name).toLowerCase();
            break;
          case "date":
            valA = new Date(a.updatedAt).getTime();
            valB = new Date(b.updatedAt).getTime();
            break;
          case "type":
            valA = a.type.toLowerCase();
            valB = b.type.toLowerCase();
            break;
          default:
            return 0;
        }

        if (valA < valB) return sortDirection === "asc" ? -1 : 1;
        if (valA > valB) return sortDirection === "asc" ? 1 : -1;

        const nameA = (a.type === "note" ? (a as Note).title : a.name).toLowerCase();
        const nameB = (b.type === "note" ? (b as Note).title : b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    },
    [sortKey, sortDirection]
  );

  const handleTagClick = (tagId: string, tagName: string) => {
    setActiveSection("tags");
    setActiveItem(tagId);
    setSearchTerm("");
  };

  const handleFolderClick = (folderId: string) => {
    setActiveSection("folders");
    setActiveItem(folderId);
    setSearchTerm("");
  };

  const handleExtensionClick = (extension: string) => {
    setActiveSection("extensions");
    setActiveItem(extension);
    setSearchTerm("");
  };

  const handleAllFilesClick = () => {
    setActiveSection("files");
    setActiveItem(null);
    setSearchTerm("");
  };

  const handleDeleteTag = (e: React.MouseEvent, tagId: string, tagName: string) => {
    e.stopPropagation();
    console.log(`Attempting to delete tag: ${tagName} (ID: ${tagId})`);
    setTagsData(tagsData.filter((tag) => tag.id !== tagId));
  };

  const handleDeleteFolder = (e: React.MouseEvent, folderId: string, folderName: string) => {
    e.stopPropagation();
    console.log(`Attempting to delete folder: ${folderName} (ID: ${folderId})`);
    // Remove the folder and all its children
    const removeFolder = (id: string) => {
      // Remove all items in this folder
      setNotes(notes.filter((note) => note.parentId !== id));
      setFiles(files.filter((file) => file.parentId !== id));

      // Remove child folders recursively
      const childFolders = folders.filter((folder) => folder.parentId === id);
      childFolders.forEach((child) => removeFolder(child.id));

      // Remove the folder itself
      setFolders(folders.filter((folder) => folder.id !== id));
    };
    removeFolder(folderId);
  };

  const handleDeleteExtension = (e: React.MouseEvent, extension: string) => {
    e.stopPropagation();
    console.log(`Attempting to delete all files with extension: ${extension}`);
    if (confirm(`Are you sure you want to delete all files with extension "${extension}"?`)) {
      setFiles(files.filter((file) => file.extension !== extension));
    }
  };

  const getDisplayTitle = () => {
    if (searchTerm) return `Search Results for: "${searchTerm}"`;
    if (activeSection === "tags" && activeItem) {
      const tag = tagsData.find((t) => t.id === activeItem);
      return `Tag: #${tag?.name || "Unknown"}`;
    }
    if (activeSection === "folders" && activeItem) {
      const folder = folders.find((f) => f.id === activeItem);
      return `Folder: ${folder?.name || "Unknown"}`;
    }
    if (activeSection === "files") return "All Files";
    if (activeSection === "extensions" && activeItem) {
      return `Extension: ${activeItem}`;
    }
    return "Select a category to view items";
  };

  const handleAddTag = () => {
    const tagName = prompt("Enter new tag name:");
    if (tagName && tagName.trim()) {
      const newTag: TagData = {
        id: `t${tagsData.length + 1}`,
        name: tagName.trim(),
        color: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random color
      };
      setTagsData([...tagsData, newTag]);
    }
  };

  const handleAddFolder = () => {
    const folderName = prompt("Enter new folder name:");
    if (folderName && folderName.trim()) {
      const newFolder: Folder = {
        id: `f${folders.length + 1}`,
        name: folderName.trim(),
        parentId: activeSection === "folders" ? activeItem : null,
        type: "folder",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setFolders([...folders, newFolder]);
    }
  };

  const handleAddFile = () => {
    const fileName = prompt("Enter new file name (with extension):");
    if (fileName && fileName.trim()) {
      const extension = fileName.includes(".")
        ? fileName.substring(fileName.lastIndexOf("."))
        : ".txt";
      const newFile: FileItem = {
        id: `file${files.length + 1}`,
        name: fileName.trim(),
        parentId: activeSection === "folders" ? activeItem : null,
        type: "file",
        extension,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setFiles([...files, newFile]);
    }
  };

  const handleAddExtension = () => {
    const extension = prompt("Enter new file extension (e.g. .pdf):");
    if (extension && extension.trim()) {
      const formattedExt = extension.startsWith(".") ? extension : `.${extension}`;
      const fileName = `New${formattedExt}`;
      const newFile: FileItem = {
        id: `file${files.length + 1}`,
        name: fileName,
        parentId: null,
        type: "file",
        extension: formattedExt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setFiles([...files, newFile]);
    }
  };

  const handleDeleteItem = (e: React.MouseEvent, item: Item) => {
    e.stopPropagation();

    if (item.type === "folder") {
      if (confirm(`Are you sure you want to delete folder "${item.name}" and all its contents?`)) {
        // Remove the folder and all its children recursively
        const removeFolder = (id: string) => {
          // Remove all items in this folder
          setNotes(notes.filter((note) => note.parentId !== id));
          setFiles(files.filter((file) => file.parentId !== id));

          // Remove child folders recursively
          const childFolders = folders.filter((folder) => folder.parentId === id);
          childFolders.forEach((child) => removeFolder(child.id));

          // Remove the folder itself
          setFolders(folders.filter((folder) => folder.id !== id));
        };
        removeFolder(item.id);
      }
    } else if (item.type === "note") {
      if (confirm(`Are you sure you want to delete note "${(item as Note).title}"?`)) {
        setNotes(notes.filter((note) => note.id !== item.id));
      }
    } else if (item.type === "file") {
      if (confirm(`Are you sure you want to delete file "${item.name}"?`)) {
        setFiles(files.filter((file) => file.id !== item.id));
      }
    }
  };

  return (
    <TooltipProvider>
      <ResizablePanelGroup direction="horizontal" className="tw-size-full">
        {/!* Left Sidebar - Navigation *!/}
        <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
          <div className="tw-flex tw-h-full tw-flex-col">
            {/!* Header *!/}
            <div className="tw-border-b tw-p-4">
              <h2 className="tw-text-lg tw-font-semibold">Project Context</h2>
            </div>

            <ScrollArea className="tw-flex-1">
              <div className="tw-space-y-6 tw-p-4">
                {/!* Tags Section *!/}
                <div>
                  <div className="tw-justify-betw-een tw-mb-3 tw-flex tw-items-center">
                    <div className="tw-flex tw-items-center">
                      <TagIcon className="tw-text-amber-600 tw-mr-2 tw-size-4" />
                      <h3 className="tw-text-amber-700 tw-text-sm tw-font-semibold">Tags</h3>
                    </div>
                    <button
                      onClick={handleAddTag}
                      className="hover:tw-bg-muted tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded-full"
                      title="Add new tag"
                    >
                      <PlusCircle className="tw-text-amber-600 tw-size-4" />
                    </button>
                  </div>
                  <div className="tw-space-y-1">
                    {tagsData
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((tag) => (
                        <div
                          key={tag.id}
                          className={cn(
                            "tw-justify-between hover:tw-bg-muted tw-group tw-flex tw-cursor-pointer tw-items-center tw-rounded-md tw-p-2",
                            activeSection === "tags" &&
                              activeItem === tag.id &&
                              "tw-text-primary tw-bg-primary/10"
                          )}
                          onClick={() => handleTagClick(tag.id, tag.name)}
                        >
                          <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center">
                            <span className="tw-text-gray-400 tw-mr-2">#</span>
                            <span className="tw-truncate tw-text-sm">{tag.name}</span>
                          </div>
                          <div className="tw-flex tw-items-center tw-gap-2">
                            <span className="tw-text-muted-foreground tw-text-xs group-hover:tw-hidden">
                              {tagNoteCounts[tag.id] || 0}
                            </span>
                            <XIcon
                              className="tw-text-muted-foreground hover:tw-text-destructive tw-hidden tw-size-4 group-hover:tw-block"
                              onClick={(e) => handleDeleteTag(e, tag.id, tag.name)}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                <Separator />

                {/!* Folders Section *!/}
                <div>
                  <div className="tw-justify-betw-een tw-mb-3 tw-flex tw-items-center">
                    <div className="tw-flex tw-items-center">
                      <FolderIcon className="tw-text-yellow-600 tw-mr-2 tw-size-4" />
                      <h3 className="tw-text-yellow-700 tw-text-sm tw-font-semibold">Folders</h3>
                    </div>
                    <button
                      onClick={handleAddFolder}
                      className="hover:tw-bg-muted tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded-full"
                      title="Add new folder"
                    >
                      <PlusCircle className="tw-text-yellow-600 tw-size-4" />
                    </button>
                  </div>
                  <div className="tw-space-y-1">
                    {folders
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((folder) => (
                        <div
                          key={folder.id}
                          className={cn(
                            "tw-justify-betw-een hover:tw-bg-muted tw-group tw-flex tw-cursor-pointer tw-items-center tw-rounded-md tw-p-2",
                            activeSection === "folders" &&
                              activeItem === folder.id &&
                              "tw-text-primary tw-bg-primary/10"
                          )}
                          onClick={() => handleFolderClick(folder.id)}
                        >
                          <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center">
                            <FolderIcon className="tw-text-yellow-500 tw-mr-2 tw-size-4" />
                            <span className="tw-truncate tw-text-sm">{folder.name}</span>
                          </div>
                          <div className="tw-flex tw-items-center tw-gap-2">
                            <span className="tw-text-muted-foreground tw-text-xs group-hover:tw-hidden">
                              {folderItemCounts[folder.id] || 0}
                            </span>
                            <XIcon
                              className="tw-text-muted-foreground hover:tw-text-destructive tw-hidden tw-size-4 group-hover:tw-block"
                              onClick={(e) => handleDeleteFolder(e, folder.id, folder.name)}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                <Separator />

                {/!* Files Section *!/}
                <div>
                  <div className="tw-justify-betw-een tw-mb-3 tw-flex tw-items-center">
                    <div className="tw-flex tw-items-center">
                      <FileText className="tw-text-blue-600 tw-mr-2 tw-size-4" />
                      <h3 className="tw-text-blue-700 tw-text-sm tw-font-semibold">Files</h3>
                    </div>
                    <button
                      onClick={handleAddFile}
                      className="hover:tw-bg-muted tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded-full"
                      title="Add new file"
                    >
                      <PlusCircle className="tw-text-blue-600 tw-size-4" />
                    </button>
                  </div>
                  <div
                    className={cn(
                      "hover:tw-bg-muted tw-cursor-pointer tw-rounded-md tw-p-2 tw-text-sm",
                      activeSection === "files" && "tw-text-primary tw-bg-primary/10"
                    )}
                    onClick={handleAllFilesClick}
                  >
                    All Files ({files.length})
                  </div>
                </div>

                <Separator />

                {/!* Extensions Section *!/}
                <div>
                  <div className="tw-justify-betw-een tw-mb-3 tw-flex tw-items-center">
                    <div className="tw-flex tw-items-center">
                      <Hash className="tw-text-green-600 tw-mr-2 tw-size-4" />
                      <h3 className="tw-text-green-700 tw-text-sm tw-font-semibold">Extensions</h3>
                    </div>
                    <button
                      onClick={handleAddExtension}
                      className="hover:tw-bg-muted tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded-full"
                      title="Add new file with extension"
                    >
                      <PlusCircle className="tw-text-green-600 tw-size-4" />
                    </button>
                  </div>
                  <div className="tw-space-y-1">
                    {uniqueExtensions.map((extension) => (
                      <div
                        key={extension}
                        className={cn(
                          "tw-justify-betw-een hover:tw-bg-muted tw-group tw-flex tw-cursor-pointer tw-items-center tw-rounded-md tw-p-2",
                          activeSection === "extensions" &&
                            activeItem === extension &&
                            "tw-text-primary tw-bg-primary/10"
                        )}
                        onClick={() => handleExtensionClick(extension)}
                      >
                        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center">
                          {getFileIcon(extension)}
                          <span className="tw-ml-2 tw-truncate tw-text-sm">{extension}</span>
                        </div>
                        <div className="tw-flex tw-items-center tw-gap-2">
                          <span className="tw-text-muted-foreground tw-text-xs group-hover:tw-hidden">
                            {extensionCounts[extension]}
                          </span>
                          <XIcon
                            className="tw-text-muted-foreground hover:tw-text-destructive tw-hidden tw-size-4 group-hover:tw-block"
                            onClick={(e) => handleDeleteExtension(e, extension)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/!* Right Content Area *!/}
        <ResizablePanel defaultSize={75}>
          <div className="tw-flex tw-h-full tw-flex-col">
            {/!* Header *!/}
            <div className="tw-border-b tw-p-4">
              <div className="tw-relative">
                <Search className="tw-text-muted-foreground tw-absolute tw-left-3 tw-top-1/2 tw-size-5 tw--translate-y-1/2" />
                <Input
                  type="text"
                  placeholder="Custom search: folder1, #tag1, [[note1]], .jpg"
                  className="tw-w-full tw-pl-10"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    if (e.target.value) {
                      setActiveSection("search");
                      setActiveItem(null);
                    }
                  }}
                />
              </div>
            </div>

            {/!* Content Title *!/}
            <div className="tw-p-4">
              <h3 className="tw-text-muted-foreground tw-text-lg tw-font-medium">
                {getDisplayTitle()}
              </h3>
            </div>

            {/!* Content Area *!/}
            <ScrollArea className="tw-flex-1 tw-p-4 tw-pt-0">
              {getDisplayItems.length === 0 ? (
                <div className="tw-text-muted-foreground tw-mt-10 tw-text-center">
                  {activeSection
                    ? "No items found."
                    : "Select a category from the sidebar to view items."}
                </div>
              ) : (
                <div className="tw-space-y-2">
                  {sortItems(getDisplayItems).map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      tags={tagsData}
                      viewMode="list"
                      onDelete={handleDeleteItem}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </TooltipProvider>
  );
}

interface ItemCardProps {
  item: Item;
  tags: TagData[];
  viewMode: "list";
  onDelete: (e: React.MouseEvent, item: Item) => void;
}

function ItemCard({ item, tags, viewMode, onDelete }: ItemCardProps) {
  const itemIcon = useMemo(() => {
    if (item.type === "folder") return <FolderIcon className="tw-text-yellow-500 tw-size-8" />;
    if (item.type === "note") return <FileText className="tw-text-indigo-500 tw-size-8" />;
    if (item.type === "file") return getFileIcon(item.extension);
    return <FileText className="tw-text-gray-500 tw-size-8" />;
  }, [item]);

  const name = item.type === "note" ? item.title : item.name;

  return (
    <div className="tw-group tw-flex tw-cursor-pointer tw-items-center tw-rounded-lg tw-border tw-p-2 tw-transition-shadow hover:tw-shadow-md">
      <div className="tw-mr-3 tw-shrink-0">
        {React.cloneElement(itemIcon, { className: "w-5 h-5" })}
      </div>
      <div className="tw-mr-2 tw-grow tw-truncate">
        <p className="tw-truncate tw-text-sm tw-font-medium">{name}</p>
        {item.type === "note" && item.contentPreview && (
          <p className="tw-text-muted-foreground tw-truncate tw-text-xs">{item.contentPreview}</p>
        )}
      </div>
      {item.type === "note" && item.tags.length > 0 && (
        <div className="tw-flex tw-max-w-[40%] tw-shrink-0 tw-flex-wrap tw-gap-1 tw-overflow-hidden">
          {item.tags.slice(0, 2).map((tagId) => {
            const tag = tags.find((t) => t.id === tagId);
            if (!tag) return null;
            return (
              <Badge
                key={tag.id}
                variant="outline"
                className="tw-text-xs"
                style={{
                  backgroundColor: tag.color ? `${tag.color}20` : undefined,
                  borderColor: tag.color,
                  color: tag.color,
                }}
              >
                {tag.name}
              </Badge>
            );
          })}
          {item.tags.length > 2 && (
            <Badge variant="outline" className="tw-text-xs">
              +{item.tags.length - 2}
            </Badge>
          )}
        </div>
      )}
      {item.type === "file" && (
        <Badge variant="outline" className="tw-text-xs">
          {item.extension}
        </Badge>
      )}
      <div className="tw-ml-auto tw-flex tw-shrink-0 tw-items-center tw-gap-2">
        <p className="tw-text-muted-foreground tw-text-xs group-hover:tw-hidden">
          {new Date(item.updatedAt).toLocaleDateString()}
        </p>
        <XIcon
          className="tw-text-muted-foreground hover:tw-text-destructive tw-hidden tw-size-4 group-hover:tw-block"
          onClick={(e) => onDelete(e, item)}
        />
      </div>
    </div>
  );
}
*/
