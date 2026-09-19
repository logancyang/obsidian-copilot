export type SearchCandidateSource = "miyo" | "filename" | "recent";

export interface SearchCandidate {
  path: string;
  title: string;
  folder: string;
  extension: string;
  snippet: string;
  mtime: number;
  score: number | null;
  source: SearchCandidateSource;
}

export interface SearchFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  mtime: number;
}

export interface SearchBooster {
  extraCandidates(query: string, types: Set<string>): SearchCandidate[];
  score(query: string, candidates: SearchCandidate[]): Promise<Map<string, number>>;
}
