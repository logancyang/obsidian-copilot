import { useMemo } from "react";
import { TFile } from "obsidian";
import fuzzysort from "fuzzysort";
import { useAllNotes } from "./useAllNotes";
import { TypeaheadOption } from "../TypeaheadMenuContent";

export interface NoteSearchOption extends TypeaheadOption {
  file: TFile;
}

export interface NoteSearchResults {
  nameMatches: NoteSearchOption[];
  pathOnlyMatches: NoteSearchOption[];
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
  limit: 10,
  threshold: -10000,
};

/**
 * Unified hook for searching notes and PDFs across both [[ and @ typeahead interfaces.
 * Ensures consistent search behavior and results between different typeahead implementations.
 * Returns separate arrays for name matches and path-only matches to allow proper prioritization.
 *
 * @param query - Search query string
 * @param isCopilotPlus - Whether Copilot Plus features are enabled (includes PDFs)
 * @param config - Optional configuration for search behavior
 * @returns Object with nameMatches and pathOnlyMatches arrays
 */
export function useNoteSearch(
  query: string,
  isCopilotPlus: boolean = false,
  config: NoteSearchConfig = {}
): NoteSearchResults {
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

  // Filter and search notes based on query
  const searchResults = useMemo(() => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // If no query, return first N notes as name matches
    if (!query.trim()) {
      return {
        nameMatches: allNoteOptions.slice(0, mergedConfig.limit),
        pathOnlyMatches: [],
      };
    }

    const searchQuery = query.trim();

    // First, search only on note names (titles)
    const nameResults = fuzzysort.go(searchQuery, allNoteOptions, {
      keys: ["title"],
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    // Then, search both title and path to find path-only matches
    const allResults = fuzzysort.go(searchQuery, allNoteOptions, {
      keys: ["title", "subtitle"],
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    // Remove duplicates (notes already included from name search)
    const nameResultSet = new Set(nameResults.map((result) => result.obj.key));
    const pathOnlyResults = allResults
      .filter((result) => !nameResultSet.has(result.obj.key))
      .slice(0, mergedConfig.limit);

    return {
      nameMatches: nameResults.map((result) => result.obj),
      pathOnlyMatches: pathOnlyResults.map((result) => result.obj),
    };
  }, [allNoteOptions, query, config]);

  return searchResults;
}
