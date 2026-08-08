import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TFile } from "obsidian";

/**
 * Binary/non-text extensions whose content the agent cannot read natively across
 * backends — parsed to text via brevilabs. Markdown and plain-text files are
 * already grep-able in the project folder, so they are never materialized.
 *
 * Lives in this UI-safe module (no converter / Node-fs / session imports) so the
 * edit modal's Content Conversion panel can enumerate candidates without pulling
 * in the materializer's heavyweight dependency graph.
 */
export const MATERIALIZE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "epub",
  "rtf",
  "xls",
  "xlsx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "tiff",
  "webp",
]);

// Referential stability: one frozen empty array for every "no candidates" exit.
const EMPTY_FILES: TFile[] = Object.freeze([] as TFile[]) as TFile[];

// Reason: `app.vault.getFiles()` order is not guaranteed stable across reloads,
// renames, or index changes. Sorting candidates by path gives both the
// materializer and the conversion UI a deterministic order, so the manifest's
// "first N of M" listing and the on-disk conversion cache stay stable run to run.
const byPath = (a: TFile, b: TFile): number => a.path.localeCompare(b.path);

/**
 * The vault files the materializer would queue for text conversion, given a
 * project's context source — the same extension + pattern filter as the
 * materializer's resolve step. Shared by the materializer itself and the edit
 * modal's Content Conversion panel, so the panel's file list always matches
 * what a session start actually materializes. Sorted by path for stable order.
 */
export function listMaterializeCandidates(
  app: App,
  contextSource: { inclusions?: string; exclusions?: string } | undefined
): TFile[] {
  const { inclusions, exclusions } = getMatchingPatterns({
    inclusions: contextSource?.inclusions,
    exclusions: contextSource?.exclusions,
    isProject: true,
  });
  if (!inclusions) return EMPTY_FILES;
  return app.vault
    .getFiles()
    .filter((file) => MATERIALIZE_EXTENSIONS.has(file.extension.toLowerCase()))
    .filter((file) => shouldIndexFile(app, file, inclusions, exclusions, true))
    .sort(byPath);
}

export interface MaterializeContextFileSummary {
  /** Binary/non-text files queued for conversion (same set as {@link listMaterializeCandidates}). */
  candidates: TFile[];
  /** Count of matched `.md` files — already grep-able, so listed only as "N skipped". */
  skippedMarkdownCount: number;
}

const EMPTY_SUMMARY: MaterializeContextFileSummary = Object.freeze({
  candidates: EMPTY_FILES,
  skippedMarkdownCount: 0,
});

/**
 * One-pass variant for the Content Conversion panel: returns the conversion
 * candidates AND how many matched files are plain markdown (no conversion
 * needed). Computed together so the panel doesn't enumerate the vault twice.
 */
export function listMaterializeContextFileSummary(
  app: App,
  contextSource: { inclusions?: string; exclusions?: string } | undefined
): MaterializeContextFileSummary {
  const { inclusions, exclusions } = getMatchingPatterns({
    inclusions: contextSource?.inclusions,
    exclusions: contextSource?.exclusions,
    isProject: true,
  });
  if (!inclusions) return EMPTY_SUMMARY;

  const matched = app.vault
    .getFiles()
    .filter((file) => shouldIndexFile(app, file, inclusions, exclusions, true))
    .sort(byPath);
  const candidates = matched.filter((file) =>
    MATERIALIZE_EXTENSIONS.has(file.extension.toLowerCase())
  );
  const skippedMarkdownCount = matched.filter(
    (file) => file.extension.toLowerCase() === "md"
  ).length;

  return {
    candidates: candidates.length > 0 ? candidates : EMPTY_FILES,
    skippedMarkdownCount,
  };
}
