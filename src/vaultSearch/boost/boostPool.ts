import type { FuzzySearch } from "@/vaultSearch/candidates";
import type { SearchCandidate, SearchFile } from "@/vaultSearch/types";

export const BOOST_MIYO_COUNT = 100;
export const BOOST_FILENAME_COUNT = 20;
export const BOOST_CREATED_COUNT = 20;
export const BOOST_MODIFIED_COUNT = 10;
export const BOOST_MAX_CANDIDATES = 150;

export type BoostPoolSource = "miyo" | "filename" | "created" | "modified";

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

function candidateFromFile(file: SearchFile, source: "filename" | "recent"): SearchCandidate {
  const slash = file.path.lastIndexOf("/");
  return {
    path: file.path,
    title: file.basename,
    folder: slash < 0 ? "" : file.path.slice(0, slash),
    extension: file.extension,
    snippet: source === "filename" ? "Filename match" : "Recent file",
    mtime: file.mtime,
    score: null,
    source,
  };
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
