import React from "react";
import { LineAcceptRejectRenderer } from "./LineAcceptRejectRenderer";

/**
 * Props for {@link PierreRenderer}.
 */
export interface PierreRendererProps {
  /** Original document text. */
  oldText: string;
  /** Proposed new document text. */
  newText: string;
  /** Path of the file being diffed (used as patch filename and for language detection). */
  path: string;
  /** "split" -> side-by-side, "unified" -> stacked. */
  diffStyle: "split" | "unified";
  /** Apply the (possibly per-line-edited) text to the file. */
  onAccept: (finalText: string) => void;
  /** Discard the proposal. */
  onReject: () => void;
}

/**
 * Apply view renderer. Wraps {@link LineAcceptRejectRenderer}, which:
 *
 *  - Shows a Pierre-rendered visual diff at the top.
 *  - Hides a per-line decision panel below it (collapsed by default — click
 *    the header to expand and override individual added/removed lines).
 *  - Provides a floating bottom bar with Accept all / Reject all shortcuts
 *    plus the final Apply button.
 *
 * The default-collapsed panel means the common "click Apply, take the whole
 * diff" workflow is one click; finer control is one extra click away.
 */
export const PierreRenderer: React.FC<PierreRendererProps> = (props) => (
  <LineAcceptRejectRenderer {...props} />
);

PierreRenderer.displayName = "PierreRenderer";
