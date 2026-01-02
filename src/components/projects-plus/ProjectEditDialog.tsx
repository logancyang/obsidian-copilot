import { Project, UpdateProjectInput } from "@/types/projects-plus";
import * as React from "react";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { SuccessCriteriaEditor } from "./SuccessCriteriaEditor";

interface ProjectEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSave: (updates: UpdateProjectInput) => Promise<void>;
}

/**
 * ProjectEditDialog - Enhanced edit dialog with all project fields
 */
export function ProjectEditDialog({ open, onOpenChange, project, onSave }: ProjectEditDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [successCriteria, setSuccessCriteria] = useState<string[]>([]);
  const [deadline, setDeadline] = useState<Date | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens or project changes
  useEffect(() => {
    if (open) {
      setTitle(project.title);
      setDescription(project.description);
      setSuccessCriteria([...project.successCriteria]);
      setDeadline(project.deadline ? new Date(project.deadline) : undefined);
    }
  }, [open, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      // Filter out empty criteria
      const filteredCriteria = successCriteria.filter((c) => c.trim().length > 0);

      await onSave({
        title: title.trim(),
        description: description.trim(),
        successCriteria: filteredCriteria,
        deadline: deadline?.getTime(),
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearDeadline = () => {
    setDeadline(undefined);
  };

  const isValid = title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tw-max-h-[80vh] tw-overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>

          <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4">
            {/* Title */}
            <div className="tw-flex tw-flex-col tw-gap-2">
              <label htmlFor="edit-title" className="tw-text-sm tw-font-medium tw-text-normal">
                Title <span className="tw-text-error">*</span>
              </label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Learn TypeScript"
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="tw-flex tw-flex-col tw-gap-2">
              <label
                htmlFor="edit-description"
                className="tw-text-sm tw-font-medium tw-text-normal"
              >
                Description
              </label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What do you want to achieve?"
                rows={3}
              />
            </div>

            {/* Success Criteria */}
            <div className="tw-flex tw-flex-col tw-gap-2">
              <label className="tw-text-sm tw-font-medium tw-text-normal">Success Criteria</label>
              <SuccessCriteriaEditor criteria={successCriteria} onChange={setSuccessCriteria} />
            </div>

            {/* Deadline */}
            <div className="tw-flex tw-flex-col tw-gap-2">
              <label className="tw-text-sm tw-font-medium tw-text-normal">Deadline</label>
              <div className="tw-flex tw-items-center tw-gap-2">
                <DatePicker
                  value={deadline}
                  onChange={setDeadline}
                  placeholder="Set a deadline..."
                  className="tw-flex-1"
                />
                {deadline && (
                  <Button
                    type="button"
                    variant="ghost2"
                    size="icon"
                    onClick={handleClearDeadline}
                    className="tw-shrink-0"
                  >
                    <X className="tw-size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
