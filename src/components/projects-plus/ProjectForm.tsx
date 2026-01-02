import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { SuccessCriteriaEditor } from "./SuccessCriteriaEditor";
import * as React from "react";
import { useEffect, useRef, useState } from "react";

export interface ProjectFormData {
  title: string;
  description: string;
  successCriteria: string[];
  deadline?: Date;
}

interface ProjectFormProps {
  /** Current form data (AI extraction + manual edits merged) */
  formData: ProjectFormData;
  /** User's manual edits (fields that user has manually changed) */
  manualEdits: Partial<ProjectFormData>;
  /** Callback when user manually edits a field */
  onManualEdit: <K extends keyof ProjectFormData>(field: K, value: ProjectFormData[K]) => void;
  /** Whether the project is ready to create */
  isReady: boolean;
}

type HighlightField = "title" | "description" | "successCriteria" | null;

/**
 * ProjectForm - Left panel form for project creation dialog
 *
 * Shows form fields with Live/Edited badges and highlight animations
 * when AI updates fields.
 */
export function ProjectForm({ formData, manualEdits, onManualEdit, isReady }: ProjectFormProps) {
  const [highlightedField, setHighlightedField] = useState<HighlightField>(null);
  const prevFormData = useRef<ProjectFormData | null>(null);

  // Track changes to trigger highlight animation
  useEffect(() => {
    if (prevFormData.current) {
      // Only highlight if AI updated (not manual edit)
      if (formData.title !== prevFormData.current.title && manualEdits.title === undefined) {
        setHighlightedField("title");
        setTimeout(() => setHighlightedField(null), 500);
      } else if (
        formData.description !== prevFormData.current.description &&
        manualEdits.description === undefined
      ) {
        setHighlightedField("description");
        setTimeout(() => setHighlightedField(null), 500);
      } else if (
        JSON.stringify(formData.successCriteria) !==
          JSON.stringify(prevFormData.current.successCriteria) &&
        manualEdits.successCriteria === undefined
      ) {
        setHighlightedField("successCriteria");
        setTimeout(() => setHighlightedField(null), 500);
      }
    }
    prevFormData.current = formData;
  }, [formData, manualEdits.title, manualEdits.description, manualEdits.successCriteria]);

  const isTitleEdited = manualEdits.title !== undefined;
  const isDescriptionEdited = manualEdits.description !== undefined;
  const isSuccessCriteriaEdited = manualEdits.successCriteria !== undefined;

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {/* Header with ready indicator */}
      <div className="tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-sm tw-font-medium tw-text-normal">Project Details</span>
        {isReady && (
          <span className="tw-rounded tw-bg-modifier-success-rgb/20 tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-text-success">
            Ready
          </span>
        )}
      </div>

      {/* Title field */}
      <div className="tw-flex tw-flex-col tw-gap-1.5">
        <div className="tw-flex tw-items-center tw-justify-between">
          <Label htmlFor="project-title">Title</Label>
          {formData.title && <FieldBadge isEdited={isTitleEdited} />}
        </div>
        <Input
          id="project-title"
          value={formData.title}
          onChange={(e) => onManualEdit("title", e.target.value)}
          placeholder="Project title..."
          className={cn(
            "tw-transition-colors",
            highlightedField === "title" && "tw-ring-2 tw-ring-ring"
          )}
        />
      </div>

      {/* Description field */}
      <div className="tw-flex tw-flex-col tw-gap-1.5">
        <div className="tw-flex tw-items-center tw-justify-between">
          <Label htmlFor="project-description">Description</Label>
          {formData.description && <FieldBadge isEdited={isDescriptionEdited} />}
        </div>
        <Textarea
          id="project-description"
          value={formData.description}
          onChange={(e) => onManualEdit("description", e.target.value)}
          placeholder="What is this project about..."
          rows={4}
          className={cn(
            "tw-resize-none tw-transition-colors",
            highlightedField === "description" && "tw-ring-2 tw-ring-ring"
          )}
        />
      </div>

      {/* Success Criteria field */}
      <div className="tw-flex tw-flex-col tw-gap-1.5">
        <div className="tw-flex tw-items-center tw-justify-between">
          <Label>Success Criteria</Label>
          {formData.successCriteria.length > 0 && <FieldBadge isEdited={isSuccessCriteriaEdited} />}
        </div>
        <div
          className={cn(
            "tw-rounded-md tw-transition-colors",
            highlightedField === "successCriteria" && "tw-ring-2 tw-ring-ring"
          )}
        >
          <SuccessCriteriaEditor
            criteria={formData.successCriteria}
            onChange={(criteria) => onManualEdit("successCriteria", criteria)}
          />
        </div>
      </div>

      {/* Deadline field */}
      <div className="tw-flex tw-flex-col tw-gap-1.5">
        <Label>Deadline (optional)</Label>
        <DatePicker
          value={formData.deadline}
          onChange={(date) => onManualEdit("deadline", date)}
          placeholder="Select deadline..."
        />
      </div>
    </div>
  );
}

/**
 * Badge showing whether a field was populated by AI (Live) or edited manually
 */
function FieldBadge({ isEdited }: { isEdited: boolean }) {
  return (
    <span
      className={cn(
        "tw-rounded tw-px-1.5 tw-py-0.5 tw-text-xs",
        isEdited
          ? "tw-bg-yellow-rgb/20 tw-text-warning"
          : "tw-bg-interactive-accent-hsl/20 tw-text-accent"
      )}
    >
      {isEdited ? "Edited" : "Live"}
    </span>
  );
}
