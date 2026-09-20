import type { MiyoSearchResult } from "@/miyo/MiyoClient";
import { logInfo } from "@/logger";
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
  boostNow: () => void;
  results: SearchCandidate[];
  miyoUnavailable: boolean;
  searching: boolean;
  boosting: boolean;
}

export function useVaultSearch(options: UseVaultSearchOptions): UseVaultSearchResult {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCandidate[]>(() => recentCandidates(options));
  const [miyoUnavailable, setMiyoUnavailable] = useState(!options.miyoEnabled);
  const [searching, setSearching] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [boostRequest, setBoostRequest] = useState(0);
  const requestSequence = useRef(0);
  const boosterSequence = useRef(0);
  const basicResults = useRef(results);
  const basicSettled = useRef(Promise.resolve());
  const immediateBoostQuery = useRef("");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const selectedTypesKey = [...options.selectedTypes].sort().join("\u0000");
  const allTypesKey = [...options.allTypes].sort().join("\u0000");
  const recentPathsKey = options.recentPaths.join("\u0000");
  const boosterEnabled = Boolean(options.booster);

  useEffect(() => {
    const currentSequence = ++requestSequence.current;
    const current = optionsRef.current;
    const trimmedQuery = query.trim();
    let settleBasic!: () => void;
    basicSettled.current = new Promise<void>((resolve) => {
      settleBasic = resolve;
    });
    const applyResults = (nextResults: SearchCandidate[]) => {
      basicResults.current = nextResults;
      setResults(nextResults);
    };
    if (!trimmedQuery) {
      applyResults(recentCandidates(current));
      setMiyoUnavailable(!current.miyoEnabled);
      setSearching(false);
      settleBasic();
      return;
    }

    const selectedTypes = new Set(current.selectedTypes);
    const localResults = matchFilesByName(
      current.files,
      selectedTypes,
      current.prepareSearch(trimmedQuery)
    );
    applyResults(localResults);
    if (!current.miyoEnabled) {
      setMiyoUnavailable(true);
      setSearching(false);
      settleBasic();
      return;
    }
    if (selectedTypes.size === 0) {
      setMiyoUnavailable(false);
      setSearching(false);
      settleBasic();
      return;
    }

    setMiyoUnavailable(false);
    setSearching(true);
    const timerWindow = current.timerWindow ?? window;
    const timer = timerWindow.setTimeout(() => {
      void (async () => {
        const startedAt = Date.now();
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
          applyResults([
            ...miyoResults,
            ...localResults.filter(({ path }) => !miyoPaths.has(path)),
          ]);
          logInfo("[Vault search basic]", {
            queryLength: trimmedQuery.length,
            resultCount: miyoResults.length,
            latencyMs: Date.now() - startedAt,
          });
          setMiyoUnavailable(false);
        } catch {
          if (currentSequence !== requestSequence.current) return;
          applyResults(localResults);
          setMiyoUnavailable(true);
        } finally {
          if (currentSequence === requestSequence.current) {
            setSearching(false);
            settleBasic();
          }
        }
      })();
    }, current.debounceMs ?? 150);
    return () => {
      timerWindow.clearTimeout(timer);
      settleBasic();
    };
  }, [allTypesKey, options.files, options.miyoEnabled, query, recentPathsKey, selectedTypesKey]);

  useEffect(() => {
    const currentSequence = ++boosterSequence.current;
    const current = optionsRef.current;
    const booster = current.booster;
    const trimmedQuery = query.trim();
    if (!booster || trimmedQuery.length < 3) {
      if (!booster) setResults(basicResults.current);
      setBoosting(false);
      return;
    }
    const selectedTypes = new Set(current.selectedTypes);
    const currentBasicSearch = basicSettled.current;
    const timerWindow = current.timerWindow ?? window;
    const timer = timerWindow.setTimeout(
      () => {
        void (async () => {
          await currentBasicSearch;
          if (currentSequence !== boosterSequence.current) return;
          const base = filterCandidatesByTypes(basicResults.current, selectedTypes);
          const seen = new Set(base.map(({ path }) => path));
          const extras = booster
            .extraCandidates(trimmedQuery, selectedTypes)
            .filter(
              (candidate) => selectedTypes.has(candidate.extension) && !seen.has(candidate.path)
            );
          const candidates = [...base, ...extras];
          try {
            setBoosting(true);
            const scores = await booster.score(trimmedQuery, candidates);
            if (currentSequence !== boosterSequence.current) return;
            const basePaths = new Set(base.map(({ path }) => path));
            setResults(
              candidates
                .filter(({ path }) => basePaths.has(path) || scores.has(path))
                .map((candidate) => {
                  const boostScore = scores.get(candidate.path);
                  return boostScore === undefined ? candidate : { ...candidate, boostScore };
                })
                .sort((left, right) => {
                  const leftScore = left.boostScore;
                  const rightScore = right.boostScore;
                  if (leftScore === undefined && rightScore === undefined) return 0;
                  if (leftScore === undefined) return 1;
                  if (rightScore === undefined) return -1;
                  return rightScore - leftScore;
                })
            );
          } catch {
            // A booster is optional enrichment; basic results stay unchanged on failure.
          } finally {
            if (currentSequence === boosterSequence.current) setBoosting(false);
          }
        })();
      },
      immediateBoostQuery.current === trimmedQuery ? 0 : (current.boosterSettleMs ?? 400)
    );
    return () => timerWindow.clearTimeout(timer);
  }, [boosterEnabled, boostRequest, query, selectedTypesKey]);

  const boostNow = () => {
    immediateBoostQuery.current = query.trim();
    setBoostRequest((request) => request + 1);
  };

  return { query, setQuery, boostNow, results, miyoUnavailable, searching, boosting };
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
