import type { MiyoSearchResult } from "@/miyo/MiyoClient";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";
import type { SearchResult } from "obsidian";

export type FuzzySearch = (text: string) => SearchResult | null;

export function groupMiyoResults(
  results: MiyoSearchResult[],
  selectedTypes: ReadonlySet<string>
): SearchCandidate[] {
  const byPath = new Map<string, SearchCandidate>();
  for (const result of results) {
    const extension = extensionFromPath(result.path);
    if (!selectedTypes.has(extension)) continue;
    const existing = byPath.get(result.path);
    if (existing && existing.score !== null && existing.score >= result.score) continue;
    byPath.set(result.path, {
      path: result.path,
      title: result.title?.trim() || basenameWithoutExtension(result.path),
      folder: folderFromPath(result.path),
      extension,
      snippet: result.snippet?.trim() || result.chunk_text?.trim() || "",
      mtime: result.mtime ?? 0,
      score: result.score,
      source: "miyo",
    });
  }
  return [...byPath.values()].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

export function matchFilesByName(
  files: SearchFile[],
  selectedTypes: ReadonlySet<string>,
  fuzzySearch: FuzzySearch
): SearchCandidate[] {
  return files
    .filter((file) => selectedTypes.has(file.extension.toLowerCase()))
    .map((file) => ({ file, match: fuzzySearch(file.basename) }))
    .filter((entry): entry is { file: SearchFile; match: SearchResult } => entry.match !== null)
    .sort((left, right) => right.match.score - left.match.score)
    .map(({ file }) => ({
      path: file.path,
      title: file.basename,
      folder: folderFromPath(file.path),
      extension: file.extension.toLowerCase(),
      snippet: "Filename match",
      mtime: file.mtime,
      score: null,
      source: "filename",
    }));
}

export function filterCandidatesByTypes(
  candidates: SearchCandidate[],
  selectedTypes: ReadonlySet<string>
): SearchCandidate[] {
  return candidates.filter((candidate) => selectedTypes.has(candidate.extension));
}

function extensionFromPath(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function basenameWithoutExtension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

function folderFromPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
