import type { MiyoSearchResult } from "@/miyo/MiyoClient";
import {
  filterCandidatesByTypes,
  groupMiyoResults,
  matchFilesByName,
  type FuzzySearch,
} from "@/vaultSearch/candidates";
import type { SearchBooster, SearchCandidate, SearchFile } from "@/vaultSearch/types";
import { useEffect, useRef, useState } from "react";

export interface UseVaultSearchOptions {
  files: SearchFile[];
  recentPaths: string[];
  selectedTypes: ReadonlySet<string>;
  allTypes: readonly string[];
  miyoEnabled: boolean;
  searchMiyo: (query: string, paths?: string[]) => Promise<MiyoSearchResult[]>;
  prepareSearch: (query: string) => FuzzySearch;
  mapMiyoPath?: (path: string) => string;
  booster?: SearchBooster;
  debounceMs?: number;
  boosterSettleMs?: number;
  timerWindow?: Pick<Window, "setTimeout" | "clearTimeout">;
}

export interface UseVaultSearchResult {
  query: string;
  setQuery: (query: string) => void;
  results: SearchCandidate[];
  miyoUnavailable: boolean;
  searching: boolean;
}

export function useVaultSearch(options: UseVaultSearchOptions): UseVaultSearchResult {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCandidate[]>(() => recentCandidates(options));
  const [miyoUnavailable, setMiyoUnavailable] = useState(!options.miyoEnabled);
  const [searching, setSearching] = useState(false);
  const requestSequence = useRef(0);
  const boosterSequence = useRef(0);
  const latestResults = useRef(results);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  latestResults.current = results;

  const selectedTypesKey = [...options.selectedTypes].sort().join("\u0000");
  const allTypesKey = [...options.allTypes].sort().join("\u0000");
  const recentPathsKey = options.recentPaths.join("\u0000");
  const boosterEnabled = Boolean(options.booster);

  useEffect(() => {
    const currentSequence = ++requestSequence.current;
    const current = optionsRef.current;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults(recentCandidates(current));
      setMiyoUnavailable(!current.miyoEnabled);
      setSearching(false);
      return;
    }

    const selectedTypes = new Set(current.selectedTypes);
    const localResults = matchFilesByName(
      current.files,
      selectedTypes,
      current.prepareSearch(trimmedQuery)
    );
    setResults(localResults);
    if (!current.miyoEnabled) {
      setMiyoUnavailable(true);
      setSearching(false);
      return;
    }
    if (selectedTypes.size === 0) {
      setMiyoUnavailable(false);
      setSearching(false);
      return;
    }

    setMiyoUnavailable(false);
    setSearching(true);
    const timerWindow = current.timerWindow ?? window;
    const timer = timerWindow.setTimeout(() => {
      void (async () => {
        const paths =
          selectedTypes.size < current.allTypes.length
            ? [...selectedTypes].filter(Boolean).map((extension) => `.${extension}`)
            : undefined;
        try {
          const response = await current.searchMiyo(trimmedQuery, paths);
          if (currentSequence !== requestSequence.current) return;
          const mapped = current.mapMiyoPath
            ? response.map((result) => ({ ...result, path: current.mapMiyoPath!(result.path) }))
            : response;
          const miyoResults = groupMiyoResults(mapped, selectedTypes);
          const miyoPaths = new Set(miyoResults.map(({ path }) => path));
          setResults([...miyoResults, ...localResults.filter(({ path }) => !miyoPaths.has(path))]);
          setMiyoUnavailable(false);
        } catch {
          if (currentSequence !== requestSequence.current) return;
          setResults(localResults);
          setMiyoUnavailable(true);
        } finally {
          if (currentSequence === requestSequence.current) setSearching(false);
        }
      })();
    }, current.debounceMs ?? 150);
    return () => timerWindow.clearTimeout(timer);
  }, [allTypesKey, options.files, options.miyoEnabled, query, recentPathsKey, selectedTypesKey]);

  useEffect(() => {
    const currentSequence = ++boosterSequence.current;
    const current = optionsRef.current;
    const booster = current.booster;
    const trimmedQuery = query.trim();
    if (!booster || trimmedQuery.length < 3) return;
    const selectedTypes = new Set(current.selectedTypes);
    const timerWindow = current.timerWindow ?? window;
    const timer = timerWindow.setTimeout(() => {
      void (async () => {
        const base = filterCandidatesByTypes(latestResults.current, selectedTypes);
        const seen = new Set(base.map(({ path }) => path));
        const extras = booster
          .extraCandidates(trimmedQuery, selectedTypes)
          .filter(
            (candidate) => selectedTypes.has(candidate.extension) && !seen.has(candidate.path)
          );
        const candidates = [...base, ...extras];
        try {
          const scores = await booster.score(trimmedQuery, candidates);
          if (currentSequence !== boosterSequence.current) return;
          setResults(
            [...candidates].sort(
              (left, right) => (scores.get(right.path) ?? -1) - (scores.get(left.path) ?? -1)
            )
          );
        } catch {
          // A booster is optional enrichment; basic results stay unchanged on failure.
        }
      })();
    }, current.boosterSettleMs ?? 400);
    return () => timerWindow.clearTimeout(timer);
  }, [boosterEnabled, query, selectedTypesKey]);

  return { query, setQuery, results, miyoUnavailable, searching };
}

function recentCandidates(options: UseVaultSearchOptions): SearchCandidate[] {
  const byPath = new Map(options.files.map((file) => [file.path, file]));
  return options.recentPaths
    .map((path) => byPath.get(path))
    .filter((file): file is SearchFile => Boolean(file))
    .filter((file) => options.selectedTypes.has(file.extension.toLowerCase()))
    .slice(0, 10)
    .map((file) => ({
      path: file.path,
      title: file.basename,
      folder: file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "",
      extension: file.extension.toLowerCase(),
      snippet: "Recently opened",
      mtime: file.mtime,
      score: null,
      source: "recent",
    }));
}
