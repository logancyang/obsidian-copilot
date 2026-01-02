/**
 * SourceAttribution - Collapsible sources section for AI responses
 */

import { cn } from "@/lib/utils";
import { DiscussSource } from "@/types/discuss";
import { AlertTriangle } from "lucide-react";
import * as React from "react";

interface SourceAttributionProps {
  sources: DiscussSource[];
  onOpenNote: (path: string) => void;
}

/**
 * Collapsible sources section showing which notes were referenced
 */
export function SourceAttribution({ sources, onOpenNote }: SourceAttributionProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <details className="tw-mt-2 tw-rounded tw-border tw-border-solid tw-border-border tw-p-2">
      <summary className="tw-cursor-pointer tw-text-xs tw-text-muted">
        Sources ({sources.length})
      </summary>
      <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-1">
        {sources.map((source, idx) => (
          <button
            key={`${source.path}-${idx}`}
            onClick={() => source.exists && onOpenNote(source.path)}
            disabled={!source.exists}
            className={cn(
              "tw-rounded tw-border tw-border-solid tw-border-border tw-px-2 tw-py-0.5 tw-text-xs",
              source.exists
                ? "tw-bg-secondary tw-text-normal hover:tw-bg-interactive-hover"
                : "tw-bg-modifier-error-rgb/20 tw-text-muted tw-line-through"
            )}
          >
            <span className="tw-flex tw-items-center tw-gap-1">
              {source.title}
              {!source.exists && <AlertTriangle className="tw-size-3 tw-text-warning" />}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
