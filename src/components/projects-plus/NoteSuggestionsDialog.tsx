import { NoteAssignmentService } from "@/core/projects-plus/NoteAssignmentService";
import { useNoteAssignment } from "@/hooks/useNoteAssignment";
import { NoteSuggestion, Project } from "@/types/projects-plus";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import NoteSuggestions from "./NoteSuggestions";

interface NoteSuggestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  noteAssignmentService: NoteAssignmentService;
  onAddNotes: (projectId: string, suggestions: NoteSuggestion[]) => Promise<void>;
  onOpenNote?: (path: string) => void;
}

/**
 * NoteSuggestionsDialog - Dialog wrapper for AI-powered note suggestions
 */
export function NoteSuggestionsDialog({
  open,
  onOpenChange,
  project,
  noteAssignmentService,
  onAddNotes,
  onOpenNote,
}: NoteSuggestionsDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasSearchedRef = useRef(false);

  const {
    isSearching,
    result,
    selected,
    toggleSelection,
    selectAll,
    clearSelection,
    dismiss,
    search,
    reset,
    visibleSuggestions,
  } = useNoteAssignment(project, noteAssignmentService);

  // Auto-trigger search when dialog opens
  useEffect(() => {
    if (open && !hasSearchedRef.current) {
      hasSearchedRef.current = true;
      search();
    }
  }, [open, search]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      hasSearchedRef.current = false;
      reset();
    }
  }, [open, reset]);

  const handleAddSelected = async () => {
    if (selected.size === 0) return;

    setIsSubmitting(true);
    try {
      // Get the full suggestion objects for selected paths
      const selectedSuggestions = visibleSuggestions.filter((s) => selected.has(s.path));
      await onAddNotes(project.id, selectedSuggestions);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAccept = async (paths: string[]) => {
    if (paths.length === 0) return;

    setIsSubmitting(true);
    try {
      const selectedSuggestions = visibleSuggestions.filter((s) => paths.includes(s.path));
      await onAddNotes(project.id, selectedSuggestions);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tw-flex tw-max-h-[80vh] tw-max-w-[600px] tw-flex-col">
        <DialogHeader>
          <DialogTitle>Find Relevant Notes</DialogTitle>
        </DialogHeader>

        <div className="tw-flex-1 tw-overflow-y-auto tw-py-4">
          <NoteSuggestions
            suggestions={visibleSuggestions}
            selected={selected}
            onToggleSelection={toggleSelection}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onDismiss={dismiss}
            onAccept={handleAccept}
            onOpenNote={onOpenNote}
            isLoading={isSearching}
            generatedQuery={result?.generatedQuery}
            totalSearched={result?.totalSearched}
            error={result?.error}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAddSelected} disabled={selected.size === 0 || isSubmitting}>
            {isSubmitting ? "Adding..." : `Add Selected (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
