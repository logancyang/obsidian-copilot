import { Project, CreateProjectInput, UpdateProjectInput } from "@/types/projects-plus";
import * as React from "react";
import { useEffect, useState } from "react";
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

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSave: (input: CreateProjectInput | UpdateProjectInput) => Promise<void>;
  title: string;
}

/**
 * ProjectDialog - Modal for creating or editing a project
 */
export default function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSave,
  title,
}: ProjectDialogProps) {
  const [projectTitle, setProjectTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens/closes or project changes
  useEffect(() => {
    if (open) {
      setProjectTitle(project?.title ?? "");
      setDescription(project?.description ?? "");
    }
  }, [open, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectTitle.trim()) return;

    setIsSubmitting(true);
    try {
      await onSave({
        title: projectTitle.trim(),
        description: description.trim(),
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = projectTitle.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4">
            <div className="tw-flex tw-flex-col tw-gap-2">
              <label htmlFor="project-title" className="tw-text-sm tw-font-medium tw-text-normal">
                Title
              </label>
              <Input
                id="project-title"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="e.g., Learn TypeScript"
                autoFocus
              />
            </div>

            <div className="tw-flex tw-flex-col tw-gap-2">
              <label
                htmlFor="project-description"
                className="tw-text-sm tw-font-medium tw-text-normal"
              >
                Description
              </label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What do you want to achieve?"
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting ? "Saving..." : project ? "Save Changes" : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
