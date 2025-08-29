import React, { useMemo, useState, useEffect } from "react";
import { App, TFile } from "obsidian";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/ui/SearchBar";
import { FileText, Folder, Info, Trash2, X } from "lucide-react";
import { ChainType } from "@/chainFactory";
import { TruncatedText } from "@/components/TruncatedText";
import { getFolders, getMarkdownFiles, getOtherFiles } from "@/utils/addContextUtils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AddContextModalProps {
  app: App;
  chainType: ChainType;
  excludeNotePaths: string[];
  activeNote: TFile | null;
  contextNotes: TFile[]; // Currently selected notes
  contextFolders: string[]; // Currently selected folders
  onNoteSelect: (note: TFile | string) => void; // Support files and folders
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function AddContextModal({
  app,
  chainType,
  excludeNotePaths,
  activeNote,
  contextNotes,
  contextFolders,
  onNoteSelect,
  isOpen,
  onClose,
  children,
}: AddContextModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("markdown");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  // Initialize selected files with current context when modal opens
  useEffect(() => {
    if (isOpen) {
      const contextFilePaths = contextNotes.map((note) => note.path);
      const initialSelected = [...contextFilePaths, ...contextFolders];
      console.log("initialSelected", initialSelected);
      setSelectedFiles(initialSelected);
    }
  }, [isOpen, contextNotes, contextFolders]);

  const allFiles = useMemo(() => {
    // Don't exclude context files - we want to show them as selected
    const contextNotePaths = contextNotes.map((note) => note.path);
    const currentExcludePaths = excludeNotePaths.filter((path) => !contextNotePaths.includes(path));

    const markdownFiles = getMarkdownFiles(app, chainType, currentExcludePaths, activeNote);
    const folders = getFolders(app);
    const otherFiles = getOtherFiles(app, chainType, currentExcludePaths, activeNote);

    return [...markdownFiles, ...folders, ...otherFiles];
  }, [app, chainType, excludeNotePaths, activeNote, contextNotes]);

  const filteredFiles = useMemo(() => {
    let files = allFiles;

    // Filter by type
    files = files.filter((file) => {
      if (activeTab === "markdown") {
        return file.type === "markdown";
      } else if (activeTab === "folder") {
        return file.type === "folder";
      } else if (activeTab === "other") {
        return file.type === "other";
      }
      return false;
    });

    // Filter by search query
    if (searchQuery) {
      files = files.filter(
        (file) =>
          file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          file.path.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return files;
  }, [allFiles, activeTab, searchQuery]);

  const getFilteredCounts = useMemo(() => {
    let searchFilteredFiles = allFiles;

    // Filter only by search queries, not by type.
    if (searchQuery) {
      searchFilteredFiles = allFiles.filter(
        (file) =>
          file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          file.path.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return {
      markdown: searchFilteredFiles.filter((f) => f.type === "markdown").length,
      folder: searchFilteredFiles.filter((f) => f.type === "folder").length,
      other: searchFilteredFiles.filter((f) => f.type === "other").length,
    };
  }, [allFiles, searchQuery]);

  const getFileIcon = (type: string) => {
    switch (type) {
      case "markdown":
        return <FileText className="tw-size-5" />;
      case "folder":
        return <Folder className="tw-size-5" />;
      default:
        return <FileText className="tw-size-5" />;
    }
  };

  const toggleFileSelection = (fileId: string) => {
    if (selectedFiles.includes(fileId)) {
      setSelectedFiles(selectedFiles.filter((id) => id !== fileId));
    } else {
      setSelectedFiles([...selectedFiles, fileId]);
    }
  };

  const clearAllSelections = () => {
    // Remove all currently selected files and folders from context
    selectedFiles.forEach((fileId) => {
      // Check if it's a folder
      if (contextFolders.includes(fileId)) {
        // Remove folder from context
        onNoteSelect(`REMOVE_FOLDER:${fileId}`);
      } else {
        // Remove file from context
        onNoteSelect(`REMOVE_FILE:${fileId}`);
      }
    });

    // Clear selection state and close modal
    setSelectedFiles([]);
    onClose();
  };

  // Processing file added to context
  const handleAddToContext = () => {
    const contextFilePaths = contextNotes.map((note) => note.path);
    const initialSelected = [...contextFilePaths, ...contextFolders];

    // Files/folders to add (newly selected)
    const toAdd = selectedFiles.filter((fileId) => !initialSelected.includes(fileId));
    // Files/folders to remove (previously selected but now unselected)
    const toRemove = initialSelected.filter((fileId) => !selectedFiles.includes(fileId));

    // Add new selections
    toAdd.forEach((fileId) => {
      const file = allFiles.find((f) => f.id === fileId);
      if (file) {
        if (file.type === "folder") {
          // For folders, pass the folder path
          onNoteSelect(file.path);
        } else {
          // For files, pass the TFile
          const tFile = app.vault.getAbstractFileByPath(file.path);
          if (tFile instanceof TFile) {
            onNoteSelect(tFile);
          }
        }
      }
    });

    // Remove unselected items by calling their respective remove handlers
    toRemove.forEach((fileId) => {
      // Check if it's a folder
      if (contextFolders.includes(fileId)) {
        // This is a folder - we need a way to remove it
        // For now, we'll call onNoteSelect with a special format to indicate removal
        onNoteSelect(`REMOVE_FOLDER:${fileId}`);
      } else {
        // This is a file - we need a way to remove it
        onNoteSelect(`REMOVE_FILE:${fileId}`);
      }
    });

    setSelectedFiles([]);
    onClose();
  };

  // Get statistical information
  /*
  const getStats = () => {
    const markdownCount = selectedFiles.filter(
      (id) => allFiles.find((f) => f.id === id)?.type === "markdown"
    ).length;
    const folderCount = selectedFiles.filter(
      (id) => allFiles.find((f) => f.id === id)?.type === "folder"
    ).length;
    const otherCount = selectedFiles.filter(
      (id) => allFiles.find((f) => f.id === id)?.type === "other"
    ).length;

    return { markdownCount, folderCount, otherCount };
  };
*/

  /*  const stats = getStats();*/

  return (
    <Popover open={isOpen} onOpenChange={onClose}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="tw-h-[380px] tw-w-[400px] tw-p-0" side="bottom" align="center">
        <div className="tw-flex tw-h-full tw-flex-col">
          <div className="tw-flex tw-items-center tw-justify-between tw-border-x-[0] tw-border-b tw-border-t-[0]  tw-border-solid tw-border-border tw-p-2">
            <div className="tw-text-base tw-font-semibold">Add Context</div>
            {selectedFiles.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={clearAllSelections}
                className="tw-h-6 tw-bg-transparent tw-px-2 tw-text-xs !tw-text-error hover:tw-text-error"
              >
                <Trash2 className="tw-mr-1 tw-size-3" />
                Clear All ({selectedFiles.length})
              </Button>
            )}
          </div>

          <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-space-y-1.5 tw-p-2">
            <div className="tw-text-xs">
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search files..."
              />
            </div>

            {/* 选择统计 */}
            {/*
            {selectedFiles.length > 0 && (
              <div className="tw-bg-muted tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-rounded-lg tw-p-1.5">
                <span className="tw-text-xs tw-font-medium">Selected:</span>
                {stats.markdownCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="tw-bg-blue-100 tw-text-blue-800 dark:tw-bg-blue-900 dark:tw-text-blue-200 tw-h-4 tw-px-1 tw-py-0 tw-text-xs"
                  >
                    {stats.markdownCount} MD
                  </Badge>
                )}
                {stats.folderCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="tw-bg-yellow-100 tw-text-yellow-800 dark:tw-bg-yellow-900 dark:tw-text-yellow-200 tw-h-4 tw-px-1 tw-py-0 tw-text-xs"
                  >
                    {stats.folderCount} Folders
                  </Badge>
                )}
                {stats.otherCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="tw-bg-gray-100 tw-text-gray-800 dark:tw-bg-gray-800 dark:tw-text-gray-200 tw-h-4 tw-px-1 tw-py-0 tw-text-xs"
                  >
                    {stats.otherCount} Other
                  </Badge>
                )}
              </div>
            )}
*/}

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col"
            >
              <TabsList className="tw-grid tw-w-full tw-shrink-0 tw-grid-cols-3 tw-border tw-border-solid tw-border-border">
                <TabsTrigger value="markdown" className="tw-px-1 tw-text-xs">
                  <FileText className="tw-mr-1 tw-size-3" />
                  MD ({getFilteredCounts.markdown})
                </TabsTrigger>
                <TabsTrigger value="folder" className="tw-px-1 tw-text-xs">
                  <div className="tw-flex tw-items-center tw-text-center">
                    <Folder className="tw-mr-1 tw-size-3" />
                    Folder ({getFilteredCounts.folder})
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="tw-flex tw-items-center tw-text-center">
                          &nbsp;
                          <Info className="tw-size-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="tw-w-64">
                        Adding folders will only include files in the current folder
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="other" className="tw-px-1 tw-text-xs">
                  <FileText className="tw-mr-1 tw-size-3" />
                  Other ({getFilteredCounts.other})
                </TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="tw-mt-1.5 tw-min-h-0 tw-flex-1">
                <ScrollArea className="tw-h-full tw-pr-1">
                  <div className="tw-space-y-1">
                    {filteredFiles.length === 0 ? (
                      <div className="tw-py-4 tw-text-center tw-text-xs tw-text-muted">
                        {searchQuery
                          ? "No files found matching your search."
                          : "No files available."}
                      </div>
                    ) : (
                      filteredFiles.map((file) => {
                        const isSelected = selectedFiles.includes(file.id);
                        return (
                          <div
                            key={file.id}
                            className={`tw-flex tw-cursor-pointer tw-items-center tw-space-x-1.5 tw-rounded-md tw-border tw-border-solid tw-p-1.5 tw-transition-colors ${
                              isSelected
                                ? "tw-border-interactive-accent tw-bg-interactive-accent-hover/10 hover:tw-bg-modifier-hover"
                                : "tw-border-border hover:tw-bg-modifier-hover"
                            }`}
                            onClick={() => toggleFileSelection(file.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleFileSelection(file.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="tw-size-3"
                            />

                            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-space-x-1.5">
                              <div className="tw-shrink-0">{getFileIcon(file.type)}</div>
                              <div className="tw-min-w-0 tw-flex-1">
                                <div className="tw-flex tw-items-center tw-space-x-1.5">
                                  <TruncatedText className="tw-flex-1 tw-text-xs tw-font-medium">
                                    {file.name}
                                    {file.isActive && (
                                      <span className="tw-ml-1 tw-text-xs tw-text-faint">
                                        (Current)
                                      </span>
                                    )}
                                    {file.extension === "pdf" && (
                                      <span className="tw-ml-1 tw-text-xs tw-text-faint">
                                        (PDF)
                                      </span>
                                    )}
                                    {file.extension === "canvas" && (
                                      <span className="tw-ml-1 tw-text-xs tw-text-faint">
                                        (Canvas)
                                      </span>
                                    )}
                                  </TruncatedText>
                                </div>

                                <TruncatedText className="tw-flex-1 tw-text-xs tw-text-muted">
                                  {file.path}
                                </TruncatedText>
                              </div>
                            </div>

                            {isSelected && (
                              <div className="tw-shrink-0 tw-text-normal">
                                <X className="tw-size-3" />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          <div className="tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-border-t tw-p-2">
            <div className="tw-text-xs tw-text-muted">
              {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected
            </div>
            <div className="tw-flex tw-space-x-1.5">
              <Button
                variant="secondary"
                onClick={onClose}
                size="sm"
                className="tw-h-6 tw-bg-transparent tw-px-2 tw-text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddToContext}
                disabled={selectedFiles.length === 0}
                size="sm"
                className="tw-h-6 tw-px-2 tw-text-xs"
              >
                Add to Context
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
