import { Project } from "@/types/projects-plus";
import * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { calculateJourneySummary } from "./utils";

export type StatusAction = "complete" | "archive" | "reactivate";

interface ProjectStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  action: StatusAction;
  onConfirm: (reflection?: string) => Promise<void>;
}

/**
 * Get dialog content configuration based on action type
 */
function getDialogConfig(action: StatusAction, projectTitle: string) {
  switch (action) {
    case "complete":
      return {
        title: "Complete Project",
        confirmText: "Complete Project",
        confirmVariant: "default" as const,
      };
    case "archive":
      return {
        title: "Archive Project",
        description: `Are you sure you want to archive "${projectTitle}"? Archived projects can be reactivated later.`,
        confirmText: "Archive",
        confirmVariant: "secondary" as const,
      };
    case "reactivate":
      return {
        title: "Reactivate Project",
        description: `Reactivate "${projectTitle}"? This will set the project status back to active.`,
        confirmText: "Reactivate",
        confirmVariant: "default" as const,
      };
  }
}

/**
 * ProjectStatusDialog - Confirmation dialog for status changes with journey summary
 */
export function ProjectStatusDialog({
  open,
  onOpenChange,
  project,
  action,
  onConfirm,
}: ProjectStatusDialogProps) {
  const [reflection, setReflection] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const config = getDialogConfig(action, project.title);
  const journey = calculateJourneySummary(project);

  // Reset reflection when dialog opens
  React.useEffect(() => {
    if (open) {
      setReflection(project.reflection ?? "");
    }
  }, [open, project.reflection]);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(action === "complete" ? reflection.trim() || undefined : undefined);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          {config.description && <DialogDescription>{config.description}</DialogDescription>}
        </DialogHeader>

        <div className="tw-py-4">
          {action === "complete" && (
            <div className="tw-space-y-4">
              {/* Journey Summary */}
              <div className="tw-rounded-md tw-bg-secondary tw-p-3">
                <p className="tw-text-sm tw-text-normal">
                  You&apos;ve been working on this project for{" "}
                  <span className="tw-font-medium">
                    {journey.daysActive} {journey.daysActive === 1 ? "day" : "days"}
                  </span>{" "}
                  with{" "}
                  <span className="tw-font-medium">
                    {journey.notesCount} {journey.notesCount === 1 ? "note" : "notes"}
                  </span>{" "}
                  and{" "}
                  <span className="tw-font-medium">
                    {journey.conversationsCount}{" "}
                    {journey.conversationsCount === 1 ? "conversation" : "conversations"}
                  </span>
                  .
                </p>
              </div>

              {/* Reflection */}
              <div className="tw-flex tw-flex-col tw-gap-2">
                <label htmlFor="reflection" className="tw-text-sm tw-font-medium tw-text-normal">
                  Reflection (optional)
                </label>
                <Textarea
                  id="reflection"
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder="What did you learn or accomplish?"
                  rows={4}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={config.confirmVariant} onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "..." : config.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
