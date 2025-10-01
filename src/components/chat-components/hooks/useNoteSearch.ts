import React, { useMemo } from "react";
import { TFile } from "obsidian";
import { FileText, FileClock } from "lucide-react";
import fuzzysort from "fuzzysort";
import { useAllNotes } from "./useAllNotes";
import { TypeaheadOption } from "../TypeaheadMenuContent";
import { getSettings } from "@/settings/model";

export interface NoteSearchOption extends TypeaheadOption {
  file: TFile;
  category?: string;
}

/**
 * Configuration for note search behavior
 */
export interface NoteSearchConfig {
  /** Maximum number of results to return */
  limit?: number;
  /** Fuzzysort threshold for matching (-10000 = very lenient, 0 = exact match) */
  threshold?: number;
}

const DEFAULT_CONFIG: Required<NoteSearchConfig> = {
  limit: 30,
  threshold: -10000,
};

/**
 * Unified hook for searching notes and PDFs across both [[ and @ typeahead interfaces.
 * Ensures consistent search behavior and results between different typeahead implementations.
 * Searches only by note name (basename), never by path, to avoid confusion.
 *
 * @param query - Search query string
 * @param isCopilotPlus - Whether Copilot Plus features are enabled (includes PDFs)
 * @param config - Optional configuration for search behavior
 * @param currentActiveFile - Current active file to show as "Active Note" option
 * @returns Array of NoteSearchOption objects matching the query by name
 */
export function useNoteSearch(
  query: string,
  isCopilotPlus: boolean = false,
  config: NoteSearchConfig = {},
  currentActiveFile: TFile | null = null
): NoteSearchOption[] {
  // Get all available notes (including PDFs in Plus mode)
  const allNotes = useAllNotes(isCopilotPlus);

  // Transform files into NoteSearchOption objects
  const allNoteOptions = useMemo(() => {
    return allNotes.map((file, index) => ({
      key: `${file.basename}-${index}`,
      title: file.basename,
      subtitle: file.path,
      content: "", // Will be loaded async when needed
      icon: React.createElement(FileText, { className: "tw-size-4" }),
      file,
    }));
  }, [allNotes]);

  // Filter and search notes based on query (name only)
  const searchResults = useMemo(() => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const customPromptsFolder = getSettings().customPromptsFolder;

    // If no query, return first N notes with custom command notes ranked lower
    if (!query.trim()) {
      const regularNotes = allNoteOptions.filter(
        (opt) => !opt.file.path.startsWith(customPromptsFolder + "/")
      );
      const customCommandNotes = allNoteOptions.filter((opt) =>
        opt.file.path.startsWith(customPromptsFolder + "/")
      );
      const noteResults = [...regularNotes, ...customCommandNotes].slice(0, mergedConfig.limit);

      // Add "Active Note" option at the top if there is an active file
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
        return [activeNoteOption, ...noteResults];
      }

      return noteResults;
    }

    const searchQuery = query.trim();
    const queryLower = searchQuery.toLowerCase();

    // Check if "active note" contains the query as a substring (case-insensitive)
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

    // Search only on note paths (subtitles), never on names
    const results = fuzzysort.go(searchQuery, allNoteOptions, {
      keys: ["subtitle"],
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    const noteResults = results.map((result) => result.obj);

    // Prepend Active Note option if it matches
    return activeNoteOption ? [activeNoteOption, ...noteResults] : noteResults;
  }, [allNoteOptions, query, config, currentActiveFile]);

  return searchResults;
}
