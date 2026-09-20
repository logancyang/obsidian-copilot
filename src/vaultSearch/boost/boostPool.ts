import type { FuzzySearch } from "@/vaultSearch/candidates";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";
import { formatBytes } from "@/utils/formatBytes";

export const BOOST_MIYO_COUNT = 100;
export const BOOST_FILENAME_COUNT = 20;
export const BOOST_ATTRIBUTE_EXTREME_COUNT = 3;
export const BOOST_CREATED_COUNT = 20;
export const BOOST_MODIFIED_COUNT = 10;
export const BOOST_MAX_CANDIDATES = 150;

export type BoostPoolSource = "miyo" | "filename" | "attributes" | "created" | "modified";

export interface BoostPoolCandidate {
  candidate: SearchCandidate;
  file: SearchFile;
  sources: BoostPoolSource[];
  searchScore: number | null;
  searchRank: number | null;
}

interface BuildBoostPoolOptions {
  basicCandidates: SearchCandidate[];
  files: SearchFile[];
  selectedTypes: ReadonlySet<string>;
  fuzzySearch: FuzzySearch;
}

function candidateFromFile(
  file: SearchFile,
  source: "filename" | "recent" | "metadata"
): SearchCandidate {
  const slash = file.path.lastIndexOf("/");
  return {
    path: file.path,
    title: file.basename,
    folder: slash < 0 ? "" : file.path.slice(0, slash),
    extension: file.extension,
    snippet:
      source === "filename"
        ? "Filename match"
        : source === "metadata"
          ? `${formatBytes(file.size)} · ${(file.extension || "file").toUpperCase()}`
          : "Recent file",
    mtime: file.mtime,
    score: null,
    source: source === "filename" ? "filename" : "recent",
  };
}

function compareBy(
  field: "size" | "ctime" | "mtime",
  direction: "ascending" | "descending"
): (left: SearchFile, right: SearchFile) => number {
  const multiplier = direction === "descending" ? -1 : 1;
  return (left, right) =>
    multiplier * (left[field] - right[field]) || left.path.localeCompare(right.path);
}

/** Interleave per-type extremes so a large type cannot crowd smaller checked types out. */
function attributeCandidates(files: SearchFile[]): SearchCandidate[] {
  const byType = new Map<string, SearchFile[]>();
  for (const file of files) {
    const group = byType.get(file.extension) ?? [];
    group.push(file);
    byType.set(file.extension, group);
  }
  const extremes = [...byType]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => [
      [...group].sort(compareBy("size", "descending")),
      [...group].sort(compareBy("size", "ascending")),
      [...group].sort(compareBy("ctime", "descending")),
      [...group].sort(compareBy("ctime", "ascending")),
      [...group].sort(compareBy("mtime", "descending")),
      [...group].sort(compareBy("mtime", "ascending")),
    ]);
  const candidates: SearchCandidate[] = [];
  for (let rank = 0; rank < BOOST_ATTRIBUTE_EXTREME_COUNT; rank += 1) {
    for (let dimension = 0; dimension < 6; dimension += 1) {
      for (const group of extremes) {
        const file = group[dimension][rank];
        if (file) candidates.push(candidateFromFile(file, "metadata"));
      }
    }
  }
  return candidates;
}

/** Build the bounded, source-labelled file set sent to Jev. */
export function buildBoostPool({
  basicCandidates,
  files,
  selectedTypes,
  fuzzySearch,
}: BuildBoostPoolOptions): BoostPoolCandidate[] {
  const allowedFiles = files.filter((file) => selectedTypes.has(file.extension));
  const filesByPath = new Map(allowedFiles.map((file) => [file.path, file]));
  const pool = new Map<string, BoostPoolCandidate>();

  const add = (candidates: SearchCandidate[], source: BoostPoolSource, limit: number) => {
    candidates.slice(0, limit).forEach((candidate, index) => {
      const file = filesByPath.get(candidate.path);
      if (!file) return;
      const existing = pool.get(candidate.path);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        return;
      }
      if (pool.size >= BOOST_MAX_CANDIDATES) return;
      pool.set(candidate.path, {
        candidate,
        file,
        sources: [source],
        searchScore: source === "miyo" ? candidate.score : null,
        searchRank: source === "miyo" ? index + 1 : null,
      });
    });
  };

  add(
    basicCandidates.filter(({ source }) => source === "miyo"),
    "miyo",
    BOOST_MIYO_COUNT
  );
  add(
    allowedFiles
      .map((file) => ({ file, match: fuzzySearch(file.basename) }))
      .filter((entry) => entry.match !== null)
      .sort((left, right) => right.match!.score - left.match!.score)
      .map(({ file }) => candidateFromFile(file, "filename")),
    "filename",
    BOOST_FILENAME_COUNT
  );
  add(attributeCandidates(allowedFiles), "attributes", Number.POSITIVE_INFINITY);
  add(
    [...allowedFiles]
      .sort((left, right) => right.ctime - left.ctime)
      .map((file) => candidateFromFile(file, "recent")),
    "created",
    BOOST_CREATED_COUNT
  );
  add(
    [...allowedFiles]
      .sort((left, right) => right.mtime - left.mtime)
      .map((file) => candidateFromFile(file, "recent")),
    "modified",
    BOOST_MODIFIED_COUNT
  );
  return [...pool.values()];
}
