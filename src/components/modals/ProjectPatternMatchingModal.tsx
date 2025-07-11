import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getExtensionPattern,
  getFilePattern,
  getTagPattern,
} from "@/search/searchUtils";
import { File, FileText, Folder, Tag, Wrench, X } from "lucide-react";
import { App, Modal, TFile } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { CustomPatternInputModal } from "./CustomPatternInputModal";
import { ExtensionInputModal } from "./ExtensionInputModal";
import { FolderSearchModal } from "./FolderSearchModal";
import { ProjectFileSelectModal } from "./ProjectFileSelectModal";
import { TagSearchModal } from "./TagSearchModal";

function PatternListGroup({
  title,
  patterns,
  onRemove,
}: {
  title: string;
  patterns: string[];
  onRemove: (pattern: string) => void;
}) {
  return (
    <div className="tw-grid tw-grid-cols-4 tw-gap-2">
      <div className="tw-font-bold">{title}</div>
      <ul className="tw-col-span-3 tw-m-0 tw-flex tw-list-inside tw-list-disc tw-flex-col tw-gap-1 tw-pl-0">
        {patterns.map((pattern) => (
          <li
            key={pattern}
            className="tw-flex tw-gap-2 tw-rounded-md tw-pl-2 tw-pr-1 hover:tw-bg-dropdown-hover"
          >
            <TruncatedText className="tw-flex-1">{pattern}</TruncatedText>
            <Button variant="ghost2" size="fit" onClick={() => onRemove(pattern)}>
              <X className="tw-size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectPatternMatchingModalContent({
  value: initialValue,
  onUpdate,
  container,
}: {
  value: string;
  onUpdate: (value: string) => void;
  container: HTMLElement;
}) {
  const [value, setValue] = useState(initialValue);
  const patterns = getDecodedPatterns(value);
  const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } =
    categorizePatterns(patterns);

  const updateCategories = (newCategories: {
    tagPatterns?: string[];
    extensionPatterns?: string[];
    folderPatterns?: string[];
    notePatterns?: string[];
  }) => {
    const newValue = createPatternSettingsValue({
      tagPatterns: newCategories.tagPatterns ?? tagPatterns,
      extensionPatterns: newCategories.extensionPatterns ?? extensionPatterns,
      folderPatterns: newCategories.folderPatterns ?? folderPatterns,
      notePatterns: newCategories.notePatterns ?? notePatterns,
    });
    setValue(newValue);
    onUpdate(newValue);
  };

  const hasValue =
    tagPatterns.length > 0 ||
    extensionPatterns.length > 0 ||
    folderPatterns.length > 0 ||
    notePatterns.length > 0;

  return (
    <div className="tw-mt-2 tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-max-h-[400px] tw-flex-col tw-gap-2 tw-overflow-y-auto tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4">
        {!hasValue && <div className="tw-text-center tw-text-sm">No patterns specified</div>}
        {tagPatterns.length > 0 && (
          <PatternListGroup
            title="Tags"
            patterns={tagPatterns}
            onRemove={(pattern) => {
              const newPatterns = tagPatterns.filter((p) => p !== pattern);
              updateCategories({
                tagPatterns: newPatterns,
              });
            }}
          />
        )}
        {extensionPatterns.length > 0 && (
          <PatternListGroup
            title="Extensions"
            patterns={extensionPatterns}
            onRemove={(pattern) => {
              const newPatterns = extensionPatterns.filter((p) => p !== pattern);
              updateCategories({
                extensionPatterns: newPatterns,
              });
            }}
          />
        )}
        {folderPatterns.length > 0 && (
          <PatternListGroup
            title="Folders"
            patterns={folderPatterns}
            onRemove={(pattern) => {
              const newPatterns = folderPatterns.filter((p) => p !== pattern);
              updateCategories({
                folderPatterns: newPatterns,
              });
            }}
          />
        )}
        {notePatterns.length > 0 && (
          <PatternListGroup
            title="Files"
            patterns={notePatterns}
            onRemove={(pattern) => {
              const newPatterns = notePatterns.filter((p) => p !== pattern);
              updateCategories({
                notePatterns: newPatterns,
              });
            }}
          />
        )}
      </div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Add...</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" container={container}>
            <DropdownMenuItem
              onSelect={() => {
                new TagSearchModal(app, (tag) => {
                  const tagPattern = getTagPattern(tag);
                  if (tagPatterns.includes(tagPattern)) {
                    return;
                  }
                  updateCategories({
                    tagPatterns: [...tagPatterns, tagPattern],
                  });
                }).open();
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <Tag className="tw-size-4" />
                Tag
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                new FolderSearchModal(app, (folder) => {
                  if (folderPatterns.includes(folder)) {
                    return;
                  }
                  updateCategories({
                    folderPatterns: [...folderPatterns, folder],
                  });
                }).open();
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <Folder className="tw-size-4" />
                Folder
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                new ProjectFileSelectModal({
                  app,
                  onFileSelect: (file: TFile) => {
                    const filePattern = getFilePattern(file);
                    if (notePatterns.includes(filePattern)) {
                      return;
                    }
                    updateCategories({
                      notePatterns: [...notePatterns, filePattern],
                    });
                  },
                  excludeFilePaths: [],
                  titleOnly: true,
                }).open();
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <FileText className="tw-size-4" />
                Files
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                new ExtensionInputModal(app, (extension) => {
                  const extensionPattern = getExtensionPattern(extension);
                  if (extensionPatterns.includes(extensionPattern)) {
                    return;
                  }
                  updateCategories({
                    extensionPatterns: [...extensionPatterns, extensionPattern],
                  });
                }).open();
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <File className="tw-size-4" />
                Extension
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                new CustomPatternInputModal(app, (value) => {
                  const patterns = getDecodedPatterns(value);
                  const {
                    tagPatterns: newTagPatterns,
                    extensionPatterns: newExtensionPatterns,
                    folderPatterns: newFolderPatterns,
                    notePatterns: newNotePatterns,
                  } = categorizePatterns(patterns);
                  updateCategories({
                    tagPatterns: [...tagPatterns, ...newTagPatterns],
                    extensionPatterns: [...extensionPatterns, ...newExtensionPatterns],
                    folderPatterns: [...folderPatterns, ...newFolderPatterns],
                    notePatterns: [...notePatterns, ...newNotePatterns],
                  });
                }).open();
              }}
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <Wrench className="tw-size-4" />
                Custom
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export class ProjectPatternMatchingModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onUpdate: (value: string) => void,
    /** The raw pattern matching value, separated by commas */
    private value: string,
    title: string
  ) {
    super(app);
    // @ts-ignore
    this.setTitle(title);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleUpdate = (value: string) => {
      this.onUpdate(value);
    };

    this.root.render(
      <ProjectPatternMatchingModalContent
        value={this.value}
        onUpdate={handleUpdate}
        container={this.contentEl}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
