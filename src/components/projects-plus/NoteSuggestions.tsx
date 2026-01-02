import { Button } from "@/components/ui/button";
import { NoteSuggestion } from "@/types/projects-plus";
import { FileQuestion, Loader2, Plus, Search } from "lucide-react";
import * as React from "react";
import NoteCard from "./NoteCard";

interface NoteSuggestionsProps {
  /** List of visible suggestions (not dismissed) */
  suggestions: NoteSuggestion[];
  /** Set of selected note paths */
  selected: Set<string>;
  /** Toggle selection for a note */
  onToggleSelection: (path: string) => void;
  /** Select all visible suggestions */
  onSelectAll: () => void;
  /** Clear all selections */
  onClearSelection: () => void;
  /** Dismiss a suggestion */
  onDismiss: (path: string) => void;
  /** Accept selected notes */
  onAccept: (paths: string[]) => void;
  /** Open a note in Obsidian */
  onOpenNote?: (path: string) => void;
  /** Whether a search is in progress */
  isLoading?: boolean;
  /** The generated search query (for transparency) */
  generatedQuery?: string;
  /** Total notes searched */
  totalSearched?: number;
  /** Error message if search failed */
  error?: string;
}

/**
 * NoteSuggestions - Panel for displaying AI-suggested notes
 */
export default function NoteSuggestions({
  suggestions,
  selected,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onDismiss,
  onAccept,
  onOpenNote,
  isLoading,
  generatedQuery,
  totalSearched,
  error,
}: NoteSuggestionsProps) {
  const handleAcceptSelected = () => {
    onAccept(Array.from(selected));
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-8">
        <Loader2 className="tw-size-8 tw-animate-spin tw-text-muted" />
        <p className="tw-mt-2 tw-text-sm tw-text-muted">Finding relevant notes...</p>
        {totalSearched !== undefined && totalSearched > 0 && (
          <p className="tw-text-xs tw-text-faint">Searching {totalSearched} notes</p>
        )}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-8">
        <Search className="tw-size-8 tw-text-error" />
        <p className="tw-mt-2 tw-text-sm tw-text-error">Search failed</p>
        <p className="tw-text-xs tw-text-faint">{error}</p>
      </div>
    );
  }

  // Empty state
  if (suggestions.length === 0) {
    return (
      <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-8">
        <FileQuestion className="tw-size-8 tw-text-muted" />
        <p className="tw-mt-2 tw-text-sm tw-text-muted">No relevant notes found</p>
        <p className="tw-text-xs tw-text-faint">Try adding more details to your project</p>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      {/* Header with count and bulk actions */}
      <div className="tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-sm tw-text-muted">
          Found {suggestions.length} relevant note{suggestions.length !== 1 ? "s" : ""}
        </span>
        <div className="tw-flex tw-gap-2">
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            Select all
          </Button>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear ({selected.size})
            </Button>
          )}
        </div>
      </div>

      {/* Generated query (for transparency) */}
      {generatedQuery && (
        <div className="tw-rounded tw-bg-secondary tw-px-2 tw-py-1 tw-text-xs tw-text-faint">
          <span className="tw-font-medium">Search query:</span> &quot;{generatedQuery}&quot;
        </div>
      )}

      {/* Suggestion cards */}
      <div className="tw-flex tw-max-h-[400px] tw-flex-col tw-gap-2 tw-overflow-y-auto">
        {suggestions.map((suggestion) => (
          <NoteCard
            key={suggestion.path}
            suggestion={suggestion}
            isSelected={selected.has(suggestion.path)}
            onToggle={() => onToggleSelection(suggestion.path)}
            onDismiss={() => onDismiss(suggestion.path)}
            onOpenNote={onOpenNote ? () => onOpenNote(suggestion.path) : undefined}
          />
        ))}
      </div>

      {/* Accept button */}
      {selected.size > 0 && (
        <Button onClick={handleAcceptSelected} className="tw-w-full">
          <Plus className="tw-mr-2 tw-size-4" />
          Add {selected.size} note{selected.size !== 1 ? "s" : ""} to project
        </Button>
      )}
    </div>
  );
}
