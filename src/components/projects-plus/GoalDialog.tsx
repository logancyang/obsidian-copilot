import { Goal, CreateGoalInput, UpdateGoalInput } from "@/types/projects-plus";
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

interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal;
  onSave: (input: CreateGoalInput | UpdateGoalInput) => Promise<void>;
  title: string;
}

/**
 * GoalDialog - Modal for creating or editing a goal
 */
export default function GoalDialog({ open, onOpenChange, goal, onSave, title }: GoalDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens/closes or goal changes
  useEffect(() => {
    if (open) {
      setName(goal?.name ?? "");
      setDescription(goal?.description ?? "");
    }
  }, [open, goal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4">
            <div className="tw-flex tw-flex-col tw-gap-2">
              <label htmlFor="goal-name" className="tw-text-sm tw-font-medium tw-text-normal">
                Name
              </label>
              <Input
                id="goal-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Learn TypeScript"
                autoFocus
              />
            </div>

            <div className="tw-flex tw-flex-col tw-gap-2">
              <label
                htmlFor="goal-description"
                className="tw-text-sm tw-font-medium tw-text-normal"
              >
                Description
              </label>
              <Textarea
                id="goal-description"
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
              {isSubmitting ? "Saving..." : goal ? "Save Changes" : "Create Goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
