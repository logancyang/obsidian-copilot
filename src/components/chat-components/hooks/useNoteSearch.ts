import React, { useMemo } from "react";
import { TFile } from "obsidian";
import { FileText, FileClock } from "lucide-react";
import fuzzysort from "fuzzysort";
import { useAllNotes } from "./useAllNotes";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";

export interface NoteSearchOption extends TypeaheadOption {
  file: TFile;
  category?: string;
}

export interface NoteSearchConfig {
  limit?: number;
  threshold?: number;
}

const DEFAULT_CONFIG: Required<NoteSearchConfig> = {
  limit: 30,
  threshold: -10000,
};

export function useNoteSearch(
  query: string,
  config: NoteSearchConfig = {},
  currentActiveFile: TFile | null = null
): NoteSearchOption[] {
  const allNotes = useAllNotes();

  const allNoteOptions = useMemo(() => {
    return allNotes.map((file, index) => ({
      key: `${file.basename}-${index}`,
      title: file.basename,
      subtitle: file.path,
      content: "",
      icon: React.createElement(FileText, { className: "tw-size-4" }),
      file,
    }));
  }, [allNotes]);

  const searchResults = useMemo(() => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (!query.trim()) {
      if (currentActiveFile) {
        const activeNoteOption: NoteSearchOption = {
          key: `active-note-${currentActiveFile.path}`,
          title: "Active Note",
          subtitle: currentActiveFile.path,
          content: "",
          category: "activeNote",
          icon: React.createElement(FileClock, { className: "tw-size-4" }),
          file: currentActiveFile,
        };
        return [activeNoteOption, ...allNoteOptions.slice(0, mergedConfig.limit - 1)];
      }

      return allNoteOptions.slice(0, mergedConfig.limit);
    }

    const searchQuery = query.trim();
    const queryLower = searchQuery.toLowerCase();

    const activeNoteTitle = "active note";
    const activeNoteMatches = activeNoteTitle.includes(queryLower);
    const activeNoteOption: NoteSearchOption | null =
      activeNoteMatches && currentActiveFile
        ? {
            key: `active-note-${currentActiveFile.path}`,
            title: "Active Note",
            subtitle: currentActiveFile.path,
            content: "",
            category: "activeNote",
            icon: React.createElement(FileClock, { className: "tw-size-4" }),
            file: currentActiveFile,
          }
        : null;

    const searchLimit = activeNoteOption ? mergedConfig.limit - 1 : mergedConfig.limit;

    const results = fuzzysort.go(searchQuery, allNoteOptions, {
      keys: ["subtitle"],
      limit: searchLimit,
      threshold: mergedConfig.threshold,
    });

    const noteResults = results.map((result) => result.obj);

    return activeNoteOption ? [activeNoteOption, ...noteResults] : noteResults;
  }, [allNoteOptions, query, config, currentActiveFile]);

  return searchResults;
}
