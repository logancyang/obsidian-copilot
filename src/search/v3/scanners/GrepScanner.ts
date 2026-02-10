import { logInfo } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TFile } from "obsidian";

/**
 * Fast substring search using Obsidian's cachedRead for initial seeding
 */
export class GrepScanner {
  private static readonly CONFIG = {
    BATCH_SIZE: 30, // Process files in batches for performance
    YIELD_INTERVAL: 100, // Yield every N files to prevent blocking
  } as const;

  constructor(private app: App) {}

  /**
   * Batch search for queries across vault files using cachedRead.
   * Uses a two-pass approach to prioritize path/filename matches:
   * - Pass 1: Collect ALL files where query terms appear in path (fast, no I/O)
   * - Pass 2: Fill remaining slots with content-only matches (requires file read)
   *
   * This ensures files like "HK Milk Tea - Home Recipe.md" are always candidates
   * when searching for "hk milk tea recipe", even in large vaults.
   *
   * @param queries - Array of search queries (will be searched as substrings)
   * @param limit - Maximum number of matching files to return
   * @returns Array of file paths that contain any of the query strings
   */
  async batchCachedReadGrep(queries: string[], limit: number): Promise<string[]> {
    // Get inclusion/exclusion patterns from settings
    const { inclusions, exclusions } = getMatchingPatterns();

    // Filter files based on inclusion/exclusion patterns
    const allFiles = this.app.vault.getMarkdownFiles();
    const files = allFiles.filter((file) => shouldIndexFile(file, inclusions, exclusions));
    const batchSize = GrepScanner.CONFIG.BATCH_SIZE;

    // Normalize queries for case-insensitive search, filtering out terms too short for meaningful grep
    const normalizedQueries = queries
      .map((q) => q.toLowerCase())
      .filter((q) => this.isGrepWorthy(q));

    // PASS 1: Collect ALL path matches (fast - no file I/O)
    // Sort by match count to prioritize files matching more query terms
    const pathMatchesWithScore: Array<{ path: string; matchCount: number }> = [];
    const yieldInterval = GrepScanner.CONFIG.YIELD_INTERVAL;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pathLower = file.path.toLowerCase();
      let matchCount = 0;

      for (const query of normalizedQueries) {
        if (pathLower.includes(query)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        pathMatchesWithScore.push({ path: file.path, matchCount });
      }

      // Yield periodically to prevent UI freezes in large vaults
      if (i > 0 && i % yieldInterval === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Sort path matches by match count (descending) to prioritize multi-term matches
    pathMatchesWithScore.sort((a, b) => b.matchCount - a.matchCount);
    const pathMatches = new Set(pathMatchesWithScore.map((m) => m.path));

    // PASS 2: Fill remaining slots with content-only matches
    const contentLimit = Math.max(0, limit - pathMatches.size);
    const contentMatches = new Set<string>();

    if (contentLimit > 0) {
      for (let i = 0; i < files.length && contentMatches.size < contentLimit; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (file) => {
            if (contentMatches.size >= contentLimit) return;
            // Skip files already matched by path
            if (pathMatches.has(file.path)) return;

            try {
              const content = await this.app.vault.cachedRead(file);
              const lower = content.toLowerCase();

              for (const query of normalizedQueries) {
                if (lower.includes(query)) {
                  contentMatches.add(file.path);
                  break;
                }
              }
            } catch (error) {
              // Skip files that can't be read
              logInfo(`GrepScanner: Skipping file ${file.path}: ${error}`);
            }
          })
        );

        // Yield periodically to prevent blocking
        if (i % GrepScanner.CONFIG.YIELD_INTERVAL === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }

    // Combine: path matches first (sorted by match count), then content matches
    const results = [...pathMatches, ...contentMatches].slice(0, limit);
    if (results.length > 0) {
      // Report actual returned counts, not raw collection sizes
      const pathCount = Math.min(pathMatches.size, limit);
      const contentCount = results.length - pathCount;
      logInfo(
        `  Grep: ${results.length} files match (${pathCount} path, ${contentCount} content) [${queries.slice(0, 3).join(", ")}${queries.length > 3 ? "..." : ""}]`
      );
    }

    return results;
  }

  /**
   * Search for a single query across vault files
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Array of matching file paths
   */
  async grep(query: string, limit: number = 200): Promise<string[]> {
    return this.batchCachedReadGrep([query], limit);
  }

  /**
   * Determines if a term is specific enough for grep matching.
   * Short ASCII terms like "na" or "an" match too many file paths, causing performance issues.
   * CJK characters are semantically dense, so shorter terms are acceptable.
   *
   * @param term - Lowercased search term
   * @returns true if the term is worth including in grep queries
   */
  private isGrepWorthy(term: string): boolean {
    if (!term || term.length === 0) {
      return false;
    }

    // CJK characters are semantically dense — allow 2+ character terms
    const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
    if (cjkPattern.test(term)) {
      return term.length >= 2;
    }

    // ASCII-only terms: require 3+ characters to avoid matching too many paths
    return term.length >= 3;
  }

  /**
   * Check if a file contains any of the queries (in content or path)
   * @param file - The file to check
   * @param queries - Array of queries to search for
   * @returns True if file contains any query
   */
  async fileContainsAny(file: TFile, queries: string[]): Promise<boolean> {
    try {
      // Check path first (faster than reading content)
      const pathLower = file.path.toLowerCase();

      // Count how many query terms match the path
      // This helps find files in folders like "Piano Lessons" when searching for "piano"
      let pathMatchCount = 0;
      for (const query of queries) {
        if (pathLower.includes(query.toLowerCase())) {
          pathMatchCount++;
        }
      }

      // If any query term matches the path, include this file
      // This ensures "Piano Lessons/Lesson 2.md" is found when searching for "piano"
      if (pathMatchCount > 0) {
        return true;
      }

      // Then check file content
      const content = await this.app.vault.cachedRead(file);
      const contentLower = content.toLowerCase();

      return queries.some((query) => contentLower.includes(query.toLowerCase()));
    } catch {
      return false;
    }
  }
}
