import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TFile } from "obsidian";

const DOCUMENT_EXTENSIONS = new Set([
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

export function listProjectDocumentFiles(
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
    .filter((file) => DOCUMENT_EXTENSIONS.has(file.extension.toLowerCase()))
    .filter((file) => shouldIndexFile(app, file, inclusions, exclusions, true))
    .sort(byPath);
}
