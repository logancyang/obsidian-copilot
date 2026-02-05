import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, ChevronUp, FileText, Folder, Hash, Plus, Tag, Wrench, X } from "lucide-react";

import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { CustomPatternInputModal } from "@/components/modals/CustomPatternInputModal";
import { ExtensionInputModal } from "@/components/modals/ExtensionInputModal";
import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import { TagSearchModal } from "@/components/modals/TagSearchModal";
import { TruncatedText } from "@/components/TruncatedText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  getExtensionPattern,
  getFilePattern,
  getTagPattern,
} from "@/search/searchUtils";

// Pattern type configuration (consistent with context-manage-modal)
const PATTERN_TYPE_CONFIG = {
  folder: { icon: Folder, label: "Folder", colorClass: "tw-text-context-manager-yellow" },
  tag: { icon: Tag, label: "Tag", colorClass: "tw-text-context-manager-orange" },
  note: { icon: FileText, label: "Note", colorClass: "tw-text-context-manager-blue" },
  extension: { icon: Hash, label: "Extension", colorClass: "tw-text-context-manager-green" },
} as const;

type PatternType = keyof typeof PATTERN_TYPE_CONFIG;

interface PatternListEditorProps {
  value: string;
  onChange: (value: string) => void;
  maxCollapsedHeight?: number;
}

export const PatternListEditor: React.FC<PatternListEditorProps> = ({
  value,
  onChange,
  maxCollapsedHeight = 84,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use ref to always have access to latest value in modal callbacks
  // This prevents stale closure issues when modal is open and settings change
  const valueRef = useRef(value);
  valueRef.current = value;

  // Helper to decode and deduplicate patterns
  const getUniquePatterns = (val: string) => [...new Set(getDecodedPatterns(val))];

  // Parse and deduplicate patterns
  const patterns = useMemo(() => getUniquePatterns(value), [value]);

  const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } = useMemo(
    () => categorizePatterns(patterns),
    [patterns]
  );

  // Use ResizeObserver to detect overflow (responds to container size changes)
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkOverflow = () => {
      const scrollHeight = el.scrollHeight;
      setContentHeight(scrollHeight);
      setIsOverflowing(scrollHeight > maxCollapsedHeight);
    };

    checkOverflow();

    // Guard for test/JSDOM environments where ResizeObserver may not exist
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    return () => observer.disconnect();
  }, [maxCollapsedHeight, patterns]);

  const isTruncated = isOverflowing && !isExpanded;
  const animatedMaxHeight = isExpanded ? contentHeight : maxCollapsedHeight;

  // Update patterns
  const updatePatterns = (newCategories: {
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
    onChange(newValue);
  };

  // Handle pattern removal
  const handleRemove = (pattern: string, type: PatternType) => {
    const filterFn = (p: string) => p !== pattern;
    switch (type) {
      case "folder":
        updatePatterns({ folderPatterns: folderPatterns.filter(filterFn) });
        break;
      case "tag":
        updatePatterns({ tagPatterns: tagPatterns.filter(filterFn) });
        break;
      case "note":
        updatePatterns({ notePatterns: notePatterns.filter(filterFn) });
        break;
      case "extension":
        updatePatterns({ extensionPatterns: extensionPatterns.filter(filterFn) });
        break;
    }
  };

  // Helper to get fresh categories from valueRef (avoids stale closure in modal callbacks)
  const getFreshCategories = () => categorizePatterns(getUniquePatterns(valueRef.current));

  // Helper to add a pattern if it doesn't already exist
  const addPatternIfNew = (
    category: keyof ReturnType<typeof categorizePatterns>,
    pattern: string
  ) => {
    const fresh = getFreshCategories();
    if (!fresh[category].includes(pattern)) {
      const newValue = createPatternSettingsValue({
        ...fresh,
        [category]: [...fresh[category], pattern],
      });
      onChange(newValue);
    }
  };

  // Handle pattern addition - use valueRef to get latest value when modal callback executes
  const handleAddFolder = () => {
    new FolderSearchModal(app, (folder) => {
      addPatternIfNew("folderPatterns", folder);
    }).open();
  };

  const handleAddTag = () => {
    new TagSearchModal(app, (tag) => {
      addPatternIfNew("tagPatterns", getTagPattern(tag));
    }).open();
  };

  const handleAddNote = () => {
    new AddContextNoteModal({
      app,
      onNoteSelect: (note) => {
        addPatternIfNew("notePatterns", getFilePattern(note));
      },
      excludeNotePaths: [],
      titleOnly: true,
    }).open();
  };

  const handleAddExtension = () => {
    new ExtensionInputModal(app, (extension) => {
      addPatternIfNew("extensionPatterns", getExtensionPattern(extension));
    }).open();
  };

  const handleAddCustom = () => {
    new CustomPatternInputModal(app, (inputValue) => {
      const fresh = getFreshCategories();
      const newPatterns = getUniquePatterns(inputValue);
      const {
        tagPatterns: newTagPatterns,
        extensionPatterns: newExtensionPatterns,
        folderPatterns: newFolderPatterns,
        notePatterns: newNotePatterns,
      } = categorizePatterns(newPatterns);
      const newValue = createPatternSettingsValue({
        tagPatterns: [
          ...fresh.tagPatterns,
          ...newTagPatterns.filter((p) => !fresh.tagPatterns.includes(p)),
        ],
        extensionPatterns: [
          ...fresh.extensionPatterns,
          ...newExtensionPatterns.filter((p) => !fresh.extensionPatterns.includes(p)),
        ],
        folderPatterns: [
          ...fresh.folderPatterns,
          ...newFolderPatterns.filter((p) => !fresh.folderPatterns.includes(p)),
        ],
        notePatterns: [
          ...fresh.notePatterns,
          ...newNotePatterns.filter((p) => !fresh.notePatterns.includes(p)),
        ],
      });
      onChange(newValue);
    }).open();
  };

  // Render a single badge (styled like context-manage-modal)
  const renderBadge = (pattern: string, type: PatternType) => {
    const config = PATTERN_TYPE_CONFIG[type];
    const Icon = config.icon;

    return (
      <Badge
        key={`${type}:${pattern}`}
        variant="secondary"
        className="tw-group tw-flex tw-h-7 tw-items-center tw-gap-1.5 tw-py-1 tw-pl-2 tw-pr-1.5 sm:tw-h-6 sm:tw-py-0.5 sm:tw-pl-1.5"
      >
        <Icon className={cn("tw-size-4 tw-shrink-0 sm:tw-size-3", config.colorClass)} />
        <TruncatedText className="tw-max-w-[100px] sm:tw-max-w-[120px]">{pattern}</TruncatedText>
        <Button
          variant="ghost2"
          size="fit"
          aria-label={`Remove ${pattern}`}
          className="tw-h-auto tw-p-0"
          onClick={() => handleRemove(pattern, type)}
        >
          <X className="tw-size-4 tw-shrink-0 tw-text-muted hover:tw-text-warning sm:tw-size-3" />
        </Button>
      </Badge>
    );
  };

  // Prepare badge data
  const allBadges = useMemo(() => {
    const badges: { pattern: string; type: PatternType }[] = [];
    folderPatterns.forEach((p) => badges.push({ pattern: p, type: "folder" }));
    tagPatterns.forEach((p) => badges.push({ pattern: p, type: "tag" }));
    notePatterns.forEach((p) => badges.push({ pattern: p, type: "note" }));
    extensionPatterns.forEach((p) => badges.push({ pattern: p, type: "extension" }));
    return badges;
  }, [folderPatterns, tagPatterns, notePatterns, extensionPatterns]);

  const hasPatterns = patterns.length > 0;

  return (
    <div ref={containerRef} className="tw-flex tw-w-full tw-flex-col tw-gap-2">
      {/* Content container */}
      <div className="tw-relative tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2">
        <div
          ref={contentRef}
          className="tw-overflow-hidden tw-transition-[max-height] tw-duration-300 tw-ease-in-out"
          style={{ maxHeight: isOverflowing ? animatedMaxHeight : undefined }}
        >
          {/* Empty state */}
          {!hasPatterns && (
            <div className="tw-py-2 tw-text-center tw-text-sm tw-italic tw-text-muted">
              No patterns configured
            </div>
          )}

          {/* Badge list - always render all, CSS handles truncation */}
          {hasPatterns && (
            <div className="tw-flex tw-flex-wrap tw-gap-1.5">
              {allBadges.map((b) => renderBadge(b.pattern, b.type))}
            </div>
          )}
        </div>

        {/* Gradient fade mask */}
        {isTruncated && (
          <div className="copilot-fade-mask-bottom tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-10 tw-rounded-b-md" />
        )}
      </div>

      {/* Control bar: single row, Show on left, Add on right */}
      <div className="tw-flex tw-flex-row tw-items-center tw-justify-between">
        {/* Expand/collapse button (left side) */}
        {isOverflowing ? (
          <Button
            variant="ghost2"
            size="sm"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="tw-h-9 tw-gap-1 tw-px-3 tw-text-accent sm:tw-h-auto sm:tw-px-2"
          >
            {isExpanded ? (
              <>
                Show less <ChevronUp className="tw-size-4 sm:tw-size-3" />
              </>
            ) : (
              <>
                Show {allBadges.length} items <ChevronDown className="tw-size-4 sm:tw-size-3" />
              </>
            )}
          </Button>
        ) : (
          <div /> // Spacer to keep Add button on the right
        )}

        {/* Add dropdown menu (right side) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="tw-h-9 tw-gap-1 tw-px-3 sm:tw-h-auto sm:tw-px-2">
              <Plus className="tw-size-5 sm:tw-size-4" />
              Add...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" container={containerRef.current}>
            <DropdownMenuItem onSelect={handleAddFolder} className="tw-py-2.5 sm:tw-py-1.5">
              <div className="tw-flex tw-items-center tw-gap-2">
                <Folder className="tw-size-5 tw-text-context-manager-yellow sm:tw-size-4" />
                Folder
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddTag} className="tw-py-2.5 sm:tw-py-1.5">
              <div className="tw-flex tw-items-center tw-gap-2">
                <Tag className="tw-size-5 tw-text-context-manager-orange sm:tw-size-4" />
                Tag
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddNote} className="tw-py-2.5 sm:tw-py-1.5">
              <div className="tw-flex tw-items-center tw-gap-2">
                <FileText className="tw-size-5 tw-text-context-manager-blue sm:tw-size-4" />
                Note
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddExtension} className="tw-py-2.5 sm:tw-py-1.5">
              <div className="tw-flex tw-items-center tw-gap-2">
                <Hash className="tw-size-5 tw-text-context-manager-green sm:tw-size-4" />
                Extension
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddCustom} className="tw-py-2.5 sm:tw-py-1.5">
              <div className="tw-flex tw-items-center tw-gap-2">
                <Wrench className="tw-size-5 tw-text-context-manager-purple sm:tw-size-4" />
                Custom
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
