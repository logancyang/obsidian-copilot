import { NoteAssignmentService } from "@/core/projects-plus/NoteAssignmentService";
import {
  NoteAssignmentOptions,
  NoteAssignmentResult,
  NoteSuggestion,
  Project,
} from "@/types/projects-plus";
import { useCallback, useState } from "react";

/**
 * Return type for the useNoteAssignment hook
 */
interface UseNoteAssignmentReturn {
  /** Whether a search is currently in progress */
  isSearching: boolean;
  /** Search results */
  result: NoteAssignmentResult | null;
  /** Set of selected note paths */
  selected: Set<string>;
  /** Set of dismissed note paths (won't be shown again) */
  dismissed: Set<string>;
  /** Toggle selection for a suggestion */
  toggleSelection: (path: string) => void;
  /** Select all suggestions */
  selectAll: () => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Dismiss a suggestion (remove from list) */
  dismiss: (path: string) => void;
  /** Execute search for relevant notes */
  search: (options?: NoteAssignmentOptions) => Promise<void>;
  /** Reset state to initial */
  reset: () => void;
  /** Get visible suggestions (not dismissed) */
  visibleSuggestions: NoteSuggestion[];
}

/**
 * Hook for managing note assignment search and selection state
 *
 * @param project - The project to find notes for
 * @param service - The NoteAssignmentService instance
 * @returns State and handlers for note assignment UI
 */
export function useNoteAssignment(
  project: Project,
  service: NoteAssignmentService
): UseNoteAssignmentReturn {
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<NoteAssignmentResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const search = useCallback(
    async (options?: NoteAssignmentOptions) => {
      setIsSearching(true);
      setSelected(new Set());
      setDismissed(new Set());
      try {
        const searchResult = await service.findRelevantNotes(project, options);
        setResult(searchResult);
      } finally {
        setIsSearching(false);
      }
    },
    [project, service]
  );

  const toggleSelection = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (result?.suggestions) {
      const visiblePaths = result.suggestions
        .filter((s) => !dismissed.has(s.path))
        .map((s) => s.path);
      setSelected(new Set(visiblePaths));
    }
  }, [result, dismissed]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const dismiss = useCallback((path: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    // Also remove from selection if selected
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setIsSearching(false);
    setResult(null);
    setSelected(new Set());
    setDismissed(new Set());
  }, []);

  // Filter out dismissed suggestions
  const visibleSuggestions = result?.suggestions.filter((s) => !dismissed.has(s.path)) ?? [];

  return {
    isSearching,
    result,
    selected,
    dismissed,
    toggleSelection,
    selectAll,
    clearSelection,
    dismiss,
    search,
    reset,
    visibleSuggestions,
  };
}
