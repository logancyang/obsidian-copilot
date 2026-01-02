/**
 * DiscussNoteTypeahead - Popover typeahead for selecting project notes
 *
 * A simplified typeahead that shows project notes for the Discuss feature.
 * Filters out already-selected notes and provides search functionality.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TFile } from "obsidian";
import { FileText } from "lucide-react";
import { TypeaheadMenuPopover } from "@/components/chat-components/TypeaheadMenuPopover";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";

interface DiscussNoteTypeaheadProps {
  /** All notes in the project */
  projectNotes: TFile[];
  /** Notes already selected (will be excluded from options) */
  selectedNotes: TFile[];
  /** Whether the popover is open */
  isOpen: boolean;
  /** Callback when the popover should close */
  onClose: () => void;
  /** Callback when a note is selected */
  onSelect: (note: TFile) => void;
}

export function DiscussNoteTypeahead({
  projectNotes,
  selectedNotes,
  isOpen,
  onClose,
  onSelect,
}: DiscussNoteTypeaheadProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter out already-selected notes
  const availableNotes = useMemo(() => {
    const selectedPaths = new Set(selectedNotes.map((n) => n.path));
    return projectNotes.filter((note) => !selectedPaths.has(note.path));
  }, [projectNotes, selectedNotes]);

  // Filter notes by search query
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) {
      return availableNotes;
    }
    const query = searchQuery.toLowerCase();
    return availableNotes.filter(
      (note) =>
        note.basename.toLowerCase().includes(query) || note.path.toLowerCase().includes(query)
    );
  }, [availableNotes, searchQuery]);

  // Convert TFiles to TypeaheadOptions
  const options: (TypeaheadOption & { file: TFile })[] = useMemo(() => {
    return filteredNotes.map((note) => ({
      key: note.path,
      title: note.basename,
      subtitle: note.parent?.path || "",
      icon: <FileText className="tw-size-4" />,
      file: note,
    }));
  }, [filteredNotes]);

  // Reset state when popover opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Reset selected index when options change
  useEffect(() => {
    setSelectedIndex(0);
  }, [options.length]);

  const handleSelect = useCallback(
    (option: TypeaheadOption) => {
      const selectedOption = options.find((o) => o.key === option.key);
      if (selectedOption) {
        onSelect(selectedOption.file);
        onClose();
      }
    },
    [options, onSelect, onClose]
  );

  const handleHighlight = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setSelectedIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = Math.min(selectedIndex + 1, options.length - 1);
          setSelectedIndex(nextIndex);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prevIndex = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(prevIndex);
          break;
        }
        case "Enter":
        case "Tab": {
          event.preventDefault();
          if (options[selectedIndex]) {
            handleSelect(options[selectedIndex]);
          }
          break;
        }
        case "Escape": {
          event.preventDefault();
          onClose();
          break;
        }
      }
    },
    [selectedIndex, options, handleSelect, onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <TypeaheadMenuPopover
      options={options}
      selectedIndex={selectedIndex}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      query={searchQuery}
      mode="search"
      showPreview={false}
      searchBarMode={true}
      searchQuery={searchQuery}
      onSearchChange={handleSearchChange}
      onKeyDown={handleKeyDown}
    />
  );
}
