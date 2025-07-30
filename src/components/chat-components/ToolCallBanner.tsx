import React, { useState } from "react";
import { ChevronRight, Check, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ToolCallBannerProps {
  toolName: string;
  displayName: string;
  emoji: string;
  isExecuting: boolean;
  result: string | null;
  confirmationMessage?: string | null;
  onAccept?: () => void;
  onReject?: () => void;
}

export const ToolCallBanner: React.FC<ToolCallBannerProps> = ({
  toolName,
  displayName,
  emoji,
  isExecuting,
  result,
  confirmationMessage,
  onAccept,
  onReject,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Don't allow expanding while executing
  const canExpand = !isExecuting && result !== null;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      disabled={!canExpand}
      className="tw-my-3 tw-w-full sm:tw-max-w-sm"
    >
      <div
        className={cn(
          "tw-rounded-md tw-border tw-border-border tw-bg-secondary/50",
          isExecuting && "tw-relative tw-overflow-hidden"
        )}
      >
        {/* Shimmer effect overlay */}
        {isExecuting && (
          <div className="tw-absolute tw-inset-0 tw-z-[1] tw-overflow-hidden">
            <div
              className="tw-absolute tw-inset-0 -tw-translate-x-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%)",
                animation: "shimmer 2s ease-in-out infinite",
              }}
            />
          </div>
        )}

        <CollapsibleTrigger
          className={cn(
            "tw-flex tw-w-full tw-items-center tw-justify-between tw-px-3 tw-py-2.5 tw-text-sm sm:tw-px-4 sm:tw-py-3",
            canExpand && "hover:tw-bg-secondary/70",
            !canExpand && "tw-cursor-default"
          )}
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className="tw-text-base">{emoji}</span>
            <span className="tw-font-medium">
              {isExecuting ? "Calling" : "Called"} {displayName}
              {isExecuting && "..."}
            </span>
            {isExecuting && confirmationMessage && (
              <span className="tw-text-xs tw-text-muted">• {confirmationMessage}...</span>
            )}
          </div>

          <div className="tw-flex tw-items-center tw-gap-2">
            {/* Future: Accept/Reject buttons */}
            {!isExecuting && onAccept && onReject && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAccept();
                  }}
                  className="hover:tw-bg-green-rgb/20 tw-rounded tw-p-1"
                  title="Accept"
                >
                  <Check className="tw-size-4 tw-text-success" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject();
                  }}
                  className="hover:tw-bg-red-rgb/20 tw-rounded tw-p-1"
                  title="Reject"
                >
                  <X className="tw-size-4 tw-text-error" />
                </button>
              </>
            )}

            {canExpand && (
              <ChevronRight
                className={cn(
                  "tw-size-4 tw-text-muted tw-transition-transform",
                  isOpen && "tw-rotate-90"
                )}
              />
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="tw-border-t tw-border-border tw-px-3 tw-py-2.5 sm:tw-px-4 sm:tw-py-3">
            <div className="tw-text-sm tw-text-muted">
              <pre className="tw-overflow-x-auto tw-whitespace-pre-wrap tw-font-mono tw-text-xs">
                {result}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
