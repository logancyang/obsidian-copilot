import { useMemo } from "react";
import { TFile } from "obsidian";
import fuzzysort from "fuzzysort";
import { useAllNotes } from "./useAllNotes";
import { TypeaheadOption } from "../TypeaheadMenuContent";

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
  limit: 10,
  threshold: -10000,
};

/**
 * Unified hook for searching notes and PDFs across both [[ and @ typeahead interfaces.
 * Ensures consistent search behavior and results between different typeahead implementations.
 *
 * @param query - Search query string
 * @param isCopilotPlus - Whether Copilot Plus features are enabled (includes PDFs)
 * @param config - Optional configuration for search behavior
 * @returns Array of NoteSearchOption objects matching the query
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

  // Filter and search notes based on query
  const searchResults = useMemo(() => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // If no query, return first N notes
    if (!query.trim()) {
      return allNoteOptions.slice(0, mergedConfig.limit);
    }

    const searchQuery = query.trim();

    // Search both title and path simultaneously using the same algorithm
    // This ensures identical behavior between [[ and @ mention typeaheads
    const results = fuzzysort.go(searchQuery, allNoteOptions, {
      keys: ["title", "subtitle"],
      limit: mergedConfig.limit,
      threshold: mergedConfig.threshold,
    });

    return results.map((result) => result.obj);
  }, [allNoteOptions, query, config]);

  return searchResults;
}
