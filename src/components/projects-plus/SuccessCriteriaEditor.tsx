import * as React from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SuccessCriteriaEditorProps {
  criteria: string[];
  onChange: (criteria: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * SuccessCriteriaEditor - Bulleted list editor for project success criteria
 */
export function SuccessCriteriaEditor({
  criteria,
  onChange,
  disabled = false,
  className,
}: SuccessCriteriaEditorProps) {
  const addCriterion = () => {
    onChange([...criteria, ""]);
  };

  const updateCriterion = (index: number, value: string) => {
    const updated = [...criteria];
    updated[index] = value;
    onChange(updated);
  };

  const removeCriterion = (index: number) => {
    onChange(criteria.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addCriterion();
    } else if (e.key === "Backspace" && criteria[index] === "") {
      e.preventDefault();
      if (criteria.length > 0) {
        removeCriterion(index);
      }
    }
  };

  return (
    <div className={cn("tw-space-y-2", className)}>
      {criteria.map((criterion, index) => (
        <div key={index} className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-select-none tw-text-muted">•</span>
          <Input
            value={criterion}
            onChange={(e) => updateCriterion(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            placeholder="Enter success criterion..."
            disabled={disabled}
            className="tw-flex-1"
          />
          <Button
            variant="ghost2"
            size="icon"
            onClick={() => removeCriterion(index)}
            disabled={disabled}
            className="tw-shrink-0"
          >
            <X className="tw-size-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={addCriterion}
        disabled={disabled}
        className="tw-flex tw-items-center tw-gap-1"
      >
        <Plus className="tw-size-4" />
        Add criterion
      </Button>
    </div>
  );
}
