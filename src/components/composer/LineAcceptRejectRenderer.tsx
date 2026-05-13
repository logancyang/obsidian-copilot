import { PatchDiff } from "@pierre/diffs/react";
import { createPatch } from "diff";
import { Check, ChevronDown, ChevronRight, X as XIcon } from "lucide-react";
import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { Button } from "../ui/button";
import {
  analyzePatch,
  reconstructFromLineDecisions,
  type Decision,
  type LineChange,
} from "./diffHunks";
import { OBSIDIAN_PIERRE_THEME } from "./pierreTheme";

/**
 * Props for {@link LineAcceptRejectRenderer}.
 */
export interface LineAcceptRejectRendererProps {
  oldText: string;
  newText: string;
  path: string;
  diffStyle: "split" | "unified";
  onAccept: (finalText: string) => void;
  onReject: () => void;
}

/** Lookup key for a single line decision: `${hunkIndex}:${lineIndex}`. */
const keyOf = (c: LineChange) => `${c.hunkIndex}:${c.lineIndex}`;

/**
 * Per-line accept/reject renderer.
 *
 * Pierre's `<PatchDiff>` doesn't expose a slot for inline per-line UI, so this
 * mode splits the view into two:
 *
 *  - Top half: a read-only Pierre diff of the proposed change, for visual
 *    context. The user reads it like a code review.
 *  - Bottom half: a structured list of every added (`+`) and removed (`-`)
 *    line, each with its own Reject / Accept toggle.
 *
 * "Accept" on an addition means "yes, insert this line in the result";
 * "accept" on a removal means "yes, drop this line from the result." That
 * matches what `git add -p` calls "stage this hunk" applied at the line level.
 *
 * Reconstruction is delegated to {@link reconstructFromLineDecisions}, which
 * rewrites each hunk to keep only the user-accepted changes and rebuilds the
 * file via {@link import("diff").applyPatch}.
 */
export const LineAcceptRejectRenderer: React.FC<LineAcceptRejectRendererProps> = ({
  oldText,
  newText,
  path,
  diffStyle,
  onAccept,
  onReject,
}) => {
  const { parsed, changes } = useMemo(
    () => analyzePatch(path, oldText, newText),
    [path, oldText, newText]
  );

  // Full-file unified patch for the read-only visual diff at the top.
  const fullPatch = useMemo(
    () => createPatch(path, oldText, newText, "", "", { context: 3 }),
    [path, oldText, newText]
  );

  // Map<"hunkIdx:lineIdx", "accept" | "reject">. Unspecified = "accept".
  const [decisions, setDecisions] = useState<Map<string, Decision>>(() => new Map());
  // Decisions panel is collapsed by default — the common case is "click Apply
  // and accept everything." Expanding reveals per-line toggles for finer control.
  const [decisionsExpanded, setDecisionsExpanded] = useState(false);

  React.useEffect(() => {
    setDecisions(new Map());
    setDecisionsExpanded(false);
  }, [parsed]);

  const totalChanges = changes.length;
  const acceptedCount = useMemo(() => {
    let n = 0;
    for (const c of changes) {
      if ((decisions.get(keyOf(c)) ?? "accept") === "accept") n++;
    }
    return n;
  }, [decisions, changes]);

  const setDecision = (c: LineChange, decision: Decision) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(keyOf(c), decision);
      return next;
    });
  };

  const acceptAll = () =>
    setDecisions(new Map(changes.map((c) => [keyOf(c), "accept" as Decision])));
  const rejectAll = () =>
    setDecisions(new Map(changes.map((c) => [keyOf(c), "reject" as Decision])));

  const applyDecisions = () => {
    const result = reconstructFromLineDecisions(oldText, parsed, decisions);
    if (result == null) {
      logError("Failed to reconstruct text from line decisions");
      new Notice("Failed to apply selected lines — patch did not match the original file.");
      return;
    }
    onAccept(result);
  };

  if (totalChanges === 0) {
    return (
      <div className="copilot-pierre-view tw-relative tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center tw-text-muted">
        <div>No changes to apply.</div>
        <Button onClick={onReject} className="tw-mt-4">
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="copilot-pierre-view tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-2 tw-overflow-auto tw-p-2">
        {/* Top: read-only visual diff. */}
        <div className="tw-rounded-md tw-border tw-border-solid tw-border-border">
          <PatchDiff
            patch={fullPatch}
            disableWorkerPool
            options={{
              diffStyle,
              diffIndicators: "bars",
              overflow: "wrap",
              // The Apply view already shows the file path + diff stats in
              // its own header — Pierre's per-file header would just be a
              // redundant second row above the diff.
              disableFileHeader: true,
              theme: { dark: OBSIDIAN_PIERRE_THEME, light: OBSIDIAN_PIERRE_THEME },
            }}
          />
        </div>

        {/* Bottom: per-line decision list — collapsed by default. Expand to
            override individual line decisions; otherwise everything stays at
            "accept" and the bottom-bar Apply button applies the full diff. */}
        <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt">
          <button
            type="button"
            onClick={() => setDecisionsExpanded((v) => !v)}
            className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-border-none tw-bg-transparent tw-px-3 tw-py-2 tw-text-left tw-text-xs tw-font-medium tw-text-muted hover:tw-text-normal"
            aria-expanded={decisionsExpanded}
          >
            {decisionsExpanded ? (
              <ChevronDown className="tw-size-3" />
            ) : (
              <ChevronRight className="tw-size-3" />
            )}
            Decisions ({acceptedCount} of {totalChanges} accepted)
            {!decisionsExpanded && (
              <span className="tw-text-muted">— click to override per line</span>
            )}
          </button>
          {/* Visible separator between the header button and the per-line list,
              only when the list is shown. Rendered as a height-0 div with a
              bottom border so the line color tracks --background-modifier-border
              under the user's theme. */}
          {decisionsExpanded && <div className="tw-border-b tw-border-solid tw-border-border" />}
          <ul className={cn("tw-m-0 tw-list-none tw-p-0", !decisionsExpanded && "tw-hidden")}>
            {changes.map((c, i) => {
              const decision = decisions.get(keyOf(c)) ?? "accept";
              const isAdd = c.kind === "+";
              return (
                <li
                  key={i}
                  className={cn(
                    "tw-flex tw-items-center tw-gap-2 tw-border-b tw-border-solid tw-border-border tw-px-3 tw-py-1.5 [&:last-child]:tw-border-b-transparent",
                    decision === "reject" && "tw-opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "tw-inline-flex tw-size-5 tw-flex-none tw-items-center tw-justify-center tw-rounded tw-font-mono tw-text-xs",
                      isAdd ? "tw-bg-success tw-text-success" : "tw-bg-error tw-text-error"
                    )}
                    aria-label={isAdd ? "addition" : "removal"}
                  >
                    {isAdd ? "+" : "-"}
                  </span>
                  <span className="tw-flex-1 tw-truncate tw-font-mono tw-text-xs">
                    {c.content || <span className="tw-text-muted">(blank line)</span>}
                  </span>
                  <div className="tw-flex tw-flex-none tw-gap-1">
                    <Button
                      variant={decision === "reject" ? "destructive" : "ghost"}
                      size="sm"
                      onClick={() => setDecision(c, "reject")}
                      title="Reject this line"
                    >
                      <XIcon className="tw-size-3" />
                    </Button>
                    <Button
                      variant={decision === "accept" ? "success" : "ghost"}
                      size="sm"
                      onClick={() => setDecision(c, "accept")}
                      title="Accept this line"
                    >
                      <Check className="tw-size-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        {/* Spacer reserves room for the floating bottom bar. The bar is ~48px
            tall (p-2 + sm button) and sits 16px above the visible bottom, so
            it occupies the bottom ~64px of the pane. We pad an extra 32px on
            top of that so the last per-line accept/reject row clears the bar
            with breathing room — without this, the bar's top edge sits flush
            against the final row's controls. */}
        <div className="tw-h-24 tw-flex-none" />
      </div>

      <div className="tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-4 tw-z-popover tw-flex tw-justify-center">
        <div className="tw-pointer-events-auto tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2 tw-shadow-lg">
          <span className="tw-px-1 tw-text-xs tw-text-muted">
            {acceptedCount} of {totalChanges} accepted
          </span>
          <Button variant="ghost" size="sm" onClick={rejectAll}>
            Reject all
          </Button>
          <Button variant="ghost" size="sm" onClick={acceptAll}>
            Accept all
          </Button>
          <Button variant="destructive" size="sm" onClick={onReject}>
            Cancel
          </Button>
          <Button variant="success" size="sm" onClick={applyDecisions}>
            <Check className="tw-size-4" />
            Apply {acceptedCount} {acceptedCount === 1 ? "line" : "lines"}
          </Button>
        </div>
      </div>
    </div>
  );
};

LineAcceptRejectRenderer.displayName = "LineAcceptRejectRenderer";
