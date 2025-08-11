import { logInfo } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TFile } from "obsidian";
import { getPlatformValue } from "../utils/platformUtils";

/**
 * Fast substring search using Obsidian's cachedRead for initial seeding
 */
export class GrepScanner {
  private static readonly CONFIG = {
    BATCH_SIZE: {
      DESKTOP: 50,
      MOBILE: 10,
    },
    YIELD_INTERVAL: 100, // Yield every N files on mobile
  } as const;

  constructor(private app: App) {}

  /**
   * Batch search for queries across vault files using cachedRead
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
    const matches = new Set<string>();
    const batchSize = getPlatformValue(
      GrepScanner.CONFIG.BATCH_SIZE.MOBILE,
      GrepScanner.CONFIG.BATCH_SIZE.DESKTOP
    );

    // Normalize queries for case-insensitive search
    const normalizedQueries = queries.map((q) => q.toLowerCase());

    for (let i = 0; i < files.length && matches.size < limit; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (file) => {
          if (matches.size >= limit) return;

          try {
            // Check path FIRST - this is much faster than reading content
            const pathLower = file.path.toLowerCase();
            let isMatch = false;

            // Check if path contains any query term
            for (const query of normalizedQueries) {
              if (pathLower.includes(query)) {
                matches.add(file.path);
                isMatch = true;
                break;
              }
            }

            // If not matched by path, check content
            if (!isMatch) {
              const content = await this.app.vault.cachedRead(file);
              const lower = content.toLowerCase();

              for (const query of normalizedQueries) {
                if (lower.includes(query)) {
                  matches.add(file.path);
                  break;
                }
              }
            }
          } catch (error) {
            // Skip files that can't be read
            logInfo(`GrepScanner: Skipping file ${file.path}: ${error}`);
          }
        })
      );

      // Yield on mobile to prevent blocking
      const isMobile = getPlatformValue(true, false);
      if (isMobile && i % GrepScanner.CONFIG.YIELD_INTERVAL === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const results = Array.from(matches).slice(0, limit);
    if (results.length > 0) {
      logInfo(
        `  Grep: ${results.length} files match [${queries.slice(0, 3).join(", ")}${queries.length > 3 ? "..." : ""}]`
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
