import * as React from "react";
import { Platform } from "obsidian";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ActionState = "idle" | "loading" | "result";

interface ActionButtonsProps {
  state: ActionState;
  onStop?: () => void;
  onInsert?: () => void;
  onReplace?: () => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  showInsertReplace?: boolean;
  showSubmitCancel?: boolean;
  className?: string;
}

/**
 * Action buttons for the modal footer.
 * Shows different buttons based on state: Stop during loading, Insert/Replace on result.
 */
export function ActionButtons({
  state,
  onStop,
  onInsert,
  onReplace,
  onSubmit,
  onCancel,
  showInsertReplace = true,
  showSubmitCancel = false,
  className,
}: ActionButtonsProps) {
  return (
    <div className={cn("tw-flex tw-items-center tw-gap-2", className)}>
      {/* Stop button during loading */}
      {state === "loading" && (
        <Button variant="secondary" size="sm" onClick={onStop}>
          Stop
        </Button>
      )}

      {/* Insert/Replace buttons on result */}
      {state === "result" && showInsertReplace && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={onInsert}
            title={`Insert below selection (${Platform.isMacOS ? "⌘" : "Ctrl"}+Shift+Enter)`}
          >
            Insert
          </Button>
          <Button
            size="sm"
            onClick={onReplace}
            title={`Replace selection (${Platform.isMacOS ? "⌘" : "Ctrl"}+Enter)`}
          >
            Replace
          </Button>
        </>
      )}

      {/* Submit/Cancel buttons (alternative mode) */}
      {showSubmitCancel && state !== "loading" && (
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit}>
            Submit
          </Button>
        </>
      )}
    </div>
  );
}
