import type { MiyoSearchResult } from "@/miyo/MiyoClient";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";
import { prepareSimpleSearch, type SearchResult } from "obsidian";

export type FuzzySearch = (text: string) => SearchResult | null;

/** Match complete query terms rather than scattered letters across a long filename. */
export function prepareFilenameSearch(query: string): FuzzySearch {
  return prepareSimpleSearch(query);
}

/**
 * Reduce a Miyo passage to a compact, readable line without rendering Markdown.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/515
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?^---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\^[^\]]+\](?::)?/g, "")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`/g, "$1$2$3$4")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
    const snippet = markdownToPlainText(result.snippet?.trim() || result.chunk_text?.trim() || "");
    const content = markdownToPlainText(result.chunk_text?.trim() || result.snippet?.trim() || "");
    byPath.set(result.path, {
      path: result.path,
      title: result.title?.trim() || basenameWithoutExtension(result.path),
      folder: folderFromPath(result.path),
      extension,
      snippet,
      ...(content ? { content } : {}),
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
  // Bound the render work for broad queries in large vaults.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/515
  return files
    .filter((file) => selectedTypes.has(file.extension.toLowerCase()))
    .map((file) => ({ file, match: fuzzySearch(file.basename) }))
    .filter((entry): entry is { file: SearchFile; match: SearchResult } => entry.match !== null)
    .sort((left, right) => right.match.score - left.match.score)
    .slice(0, 50)
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
