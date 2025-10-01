import { useMemo } from "react";
import { TFile } from "obsidian";
import fuzzysort from "fuzzysort";
import { useAllNotes } from "./useAllNotes";
import { TypeaheadOption } from "../TypeaheadMenuContent";
import { getSettings } from "@/settings/model";

export interface NoteSearchOption extends TypeaheadOption {
  file: TFile;
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
 * @returns Array of NoteSearchOption objects matching the query by name
 */
export function useNoteSearch(
  query: string,
  isCopilotPlus: boolean = false,
  config: NoteSearchConfig = {}
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
      return [...regularNotes, ...customCommandNotes].slice(0, mergedConfig.limit);
    }

    const searchQuery = query.trim();

    // Search only on note paths (subtitles), never on names
    const results = fuzzysort.go(searchQuery, allNoteOptions, {
      keys: ["subtitle"],
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    return results.map((result) => result.obj);
  }, [allNoteOptions, query, config]);

  return searchResults;
}
