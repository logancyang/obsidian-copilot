import { ProjectExtraction } from "@/types/projects-plus";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import * as React from "react";
import { useEffect, useRef, useState } from "react";

interface ProjectCreationFormProps {
  /** Current extraction values (AI + manual merged) */
  extraction: ProjectExtraction;
  /** User's manual edits */
  manualEdits: Partial<ProjectExtraction>;
  /** Callback when user manually edits a field */
  onManualEdit: (field: "name" | "description", value: string) => void;
  /** Whether the project is ready (name + description filled) */
  isReady: boolean;
}

/**
 * ProjectCreationForm - Live-updating form preview for project creation
 *
 * Shows extracted/edited values with visual feedback for auto-population.
 */
export default function ProjectCreationForm({
  extraction,
  manualEdits,
  onManualEdit,
  isReady,
}: ProjectCreationFormProps) {
  const [highlightedField, setHighlightedField] = useState<"name" | "description" | null>(null);
  const prevExtraction = useRef<ProjectExtraction | null>(null);

  // Track changes to trigger highlight animation
  useEffect(() => {
    if (prevExtraction.current) {
      // Only highlight if AI updated (not manual edit)
      if (extraction.name !== prevExtraction.current.name && manualEdits.name === undefined) {
        setHighlightedField("name");
        setTimeout(() => setHighlightedField(null), 500);
      } else if (
        extraction.description !== prevExtraction.current.description &&
        manualEdits.description === undefined
      ) {
        setHighlightedField("description");
        setTimeout(() => setHighlightedField(null), 500);
      }
    }
    prevExtraction.current = extraction;
  }, [extraction, manualEdits.name, manualEdits.description]);

  const isNameEdited = manualEdits.name !== undefined;
  const isDescriptionEdited = manualEdits.description !== undefined;

  return (
    <div className="tw-border-b tw-border-border tw-bg-secondary tw-p-3">
      <div className="tw-mb-2 tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">
          Project Preview
        </span>
        {isReady && (
          <span className="tw-rounded tw-bg-modifier-success-rgb/20 tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-text-success">
            Ready
          </span>
        )}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-3">
        {/* Name field */}
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-flex tw-items-center tw-justify-between">
            <label htmlFor="project-name" className="tw-text-xs tw-font-medium tw-text-muted">
              Name
            </label>
            {extraction.name && (
              <span
                className={cn(
                  "tw-rounded tw-px-1.5 tw-py-0.5 tw-text-xs",
                  isNameEdited
                    ? "tw-bg-yellow-rgb/20 tw-text-warning"
                    : "tw-bg-interactive-accent-hsl/20 tw-text-accent"
                )}
              >
                {isNameEdited ? "Edited" : "Live"}
              </span>
            )}
          </div>
          <Input
            id="project-name"
            value={extraction.name}
            onChange={(e) => onManualEdit("name", e.target.value)}
            placeholder="Project name will appear here..."
            className={cn(
              "tw-transition-colors",
              highlightedField === "name" && "tw-ring-2 tw-ring-ring"
            )}
          />
        </div>

        {/* Description field */}
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-flex tw-items-center tw-justify-between">
            <label
              htmlFor="project-description"
              className="tw-text-xs tw-font-medium tw-text-muted"
            >
              Description
            </label>
            {extraction.description && (
              <span
                className={cn(
                  "tw-rounded tw-px-1.5 tw-py-0.5 tw-text-xs",
                  isDescriptionEdited
                    ? "tw-bg-yellow-rgb/20 tw-text-warning"
                    : "tw-bg-interactive-accent-hsl/20 tw-text-accent"
                )}
              >
                {isDescriptionEdited ? "Edited" : "Live"}
              </span>
            )}
          </div>
          <Textarea
            id="project-description"
            value={extraction.description}
            onChange={(e) => onManualEdit("description", e.target.value)}
            placeholder="Description will appear here..."
            rows={3}
            className={cn(
              "tw-resize-none tw-transition-colors",
              highlightedField === "description" && "tw-ring-2 tw-ring-ring"
            )}
          />
        </div>
      </div>
    </div>
  );
}
