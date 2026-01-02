import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { MatchSource, NoteSuggestion } from "@/types/projects-plus";
import { X } from "lucide-react";
import * as React from "react";

interface NoteCardProps {
  suggestion: NoteSuggestion;
  isSelected: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onOpenNote?: () => void;
}

/**
 * Get badge styling based on match source
 */
function getMatchSourceStyles(matchSource: MatchSource): string {
  switch (matchSource) {
    case "hybrid":
      return "tw-bg-success tw-text-success";
    case "semantic":
      return "tw-bg-interactive-accent-hsl/20 tw-text-accent";
    case "lexical":
    default:
      return "tw-bg-secondary tw-text-muted";
  }
}

/**
 * Get readable label for match source
 */
function getMatchSourceLabel(matchSource: MatchSource): string {
  switch (matchSource) {
    case "hybrid":
      return "Both";
    case "semantic":
      return "Semantic";
    case "lexical":
    default:
      return "Keyword";
  }
}

/**
 * NoteCard - Individual note suggestion card
 */
export default function NoteCard({
  suggestion,
  isSelected,
  onToggle,
  onDismiss,
  onOpenNote,
}: NoteCardProps) {
  const scorePercent = Math.round(suggestion.relevanceScore * 100);

  const handleCardClick = (e: React.MouseEvent) => {
    // If clicking on checkbox or dismiss button, don't toggle
    const target = e.target as HTMLElement;
    if (target.closest("[data-dismiss]") || target.closest("[data-checkbox]")) {
      return;
    }
    onToggle();
  };

  const handleTitleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenNote) {
      onOpenNote();
    }
  };

  return (
    <div
      className={cn(
        "tw-flex tw-cursor-pointer tw-gap-3 tw-rounded-md tw-border tw-p-3 tw-transition-colors",
        isSelected
          ? "tw-border-interactive-accent tw-bg-interactive-accent-hsl/10"
          : "tw-border-border tw-bg-primary hover:tw-bg-modifier-hover"
      )}
      onClick={handleCardClick}
    >
      {/* Checkbox */}
      <div className="tw-flex tw-items-start tw-pt-0.5" data-checkbox>
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      </div>

      {/* Content */}
      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
          <h4
            className={cn(
              "tw-truncate tw-font-medium tw-text-normal",
              onOpenNote && "hover:tw-underline"
            )}
            onClick={handleTitleClick}
          >
            {suggestion.title}
          </h4>
          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
            {/* Relevance score */}
            <span className="tw-text-xs tw-text-muted">{scorePercent}%</span>
            {/* Match source badge */}
            <span
              className={cn(
                "tw-rounded tw-px-1.5 tw-py-0.5 tw-text-xs",
                getMatchSourceStyles(suggestion.matchSource)
              )}
            >
              {getMatchSourceLabel(suggestion.matchSource)}
            </span>
          </div>
        </div>

        {/* Excerpt */}
        {suggestion.excerpt && (
          <p className="tw-mt-1 tw-line-clamp-2 tw-text-sm tw-text-muted">{suggestion.excerpt}</p>
        )}

        {/* Tags */}
        {suggestion.tags.length > 0 && (
          <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-1">
            {suggestion.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="tw-rounded tw-bg-secondary tw-px-1.5 tw-py-0.5 tw-text-xs tw-text-faint"
              >
                {tag}
              </span>
            ))}
            {suggestion.tags.length > 3 && (
              <span className="tw-text-xs tw-text-faint">+{suggestion.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="tw-shrink-0 tw-self-start tw-rounded tw-p-1 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
        title="Not relevant"
        data-dismiss
      >
        <X className="tw-size-4" />
      </button>
    </div>
  );
}
