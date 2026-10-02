import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TFile } from "obsidian";

const MATERIALIZE_EXTENSIONS = new Set([
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

const EMPTY_FILES: TFile[] = Object.freeze([] as TFile[]) as TFile[];

const byPath = (a: TFile, b: TFile): number => a.path.localeCompare(b.path);

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
  candidates: TFile[];
  skippedMarkdownCount: number;
}

const EMPTY_SUMMARY: MaterializeContextFileSummary = Object.freeze({
  candidates: EMPTY_FILES,
  skippedMarkdownCount: 0,
});

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
