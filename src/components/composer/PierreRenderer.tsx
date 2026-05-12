import { PatchDiff } from "@pierre/diffs/react";
import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { createPatch } from "diff";
import { Check, X as XIcon } from "lucide-react";
import React, { useMemo } from "react";
import { Button } from "../ui/button";

/**
 * Register an "obsidian" Shiki theme once at module load. Every syntax-token
 * role maps to an Obsidian text variable so headings, bold, links, code, etc.
 * inside the diff render in the user's editor colors instead of Pierre's
 * stock red/orange/cyan palette. The diff red/green tints come from a
 * separate CSS layer (see .copilot-pierre-view in tailwind.css) and are
 * unaffected by this theme — they sit on the line background, not the text.
 */
const OBSIDIAN_PIERRE_THEME = "obsidian";
let __pierreThemeRegistered = false;
function ensurePierreThemeRegistered() {
  if (__pierreThemeRegistered) return;
  registerCustomCSSVariableTheme(OBSIDIAN_PIERRE_THEME, {
    foreground: "var(--text-normal)",
    background: "transparent",
    "token-constant": "var(--color-orange)",
    "token-string": "var(--text-normal)",
    "token-string-expression": "var(--text-normal)",
    "token-comment": "var(--text-muted)",
    "token-keyword": "var(--text-normal)",
    "token-parameter": "var(--text-normal)",
    "token-function": "var(--text-normal)",
    "token-punctuation": "var(--text-muted)",
    "token-link": "var(--text-accent)",
  });
  __pierreThemeRegistered = true;
}
ensurePierreThemeRegistered();

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
  /** Apply the proposed text to the file. */
  onAccept: (finalText: string) => void;
  /** Discard the proposal. */
  onReject: () => void;
}

/**
 * Renders the Apply view using @pierre/diffs.
 *
 * Pierre is a Shiki-based renderer aimed at code review UIs. It produces a
 * polished diff with syntax-highlighted markdown but does not manage per-block
 * accept/reject state, so this renderer offers only a single top-level
 * Accept / Reject pair — accepting writes `newText` verbatim, like the merge
 * view does with its right pane.
 *
 * The worker pool is disabled because Obsidian's renderer process already
 * runs in a single Electron window; spawning Shiki workers there is
 * unnecessary overhead.
 */
export const PierreRenderer: React.FC<PierreRendererProps> = ({
  oldText,
  newText,
  path,
  diffStyle,
  onAccept,
  onReject,
}) => {
  const patch = useMemo(
    () => createPatch(path, oldText, newText, "", "", { context: 3 }),
    [path, oldText, newText]
  );

  return (
    <div className="copilot-pierre-view tw-relative tw-flex tw-h-full tw-flex-col">
      {/* Floating Accept/Reject bar, centered in the pane. The row spans the
          full width so flexbox can center the pill regardless of its width;
          pointer-events are off on the row and back on for the pill itself
          so empty space doesn't swallow clicks on the diff below. */}
      <div className="tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-4 tw-z-popover tw-flex tw-justify-center">
        <div className="tw-pointer-events-auto tw-flex tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2 tw-shadow-lg">
          <Button variant="destructive" size="sm" onClick={onReject}>
            <XIcon className="tw-size-4" />
            Reject
          </Button>
          <Button variant="success" size="sm" onClick={() => onAccept(newText)}>
            <Check className="tw-size-4" />
            Accept
          </Button>
        </div>
      </div>
      <div className="tw-flex-1 tw-overflow-auto tw-p-2">
        <PatchDiff
          patch={patch}
          disableWorkerPool
          options={{
            diffStyle,
            diffIndicators: "bars",
            // Wrap long prose lines instead of horizontal scroll. The default
            // "scroll" mode truncates markdown paragraphs in side-by-side view.
            overflow: "wrap",
            // Use the Obsidian-mapped Shiki theme so every syntax token
            // (markdown heading, bold, link, code, etc.) renders in the
            // user's text-normal color instead of Pierre's stock palette.
            theme: { dark: OBSIDIAN_PIERRE_THEME, light: OBSIDIAN_PIERRE_THEME },
          }}
        />
      </div>
    </div>
  );
};

PierreRenderer.displayName = "PierreRenderer";
