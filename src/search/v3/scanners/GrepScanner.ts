import { App, Platform, TFile } from "obsidian";
import { logInfo } from "@/logger";
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
    const files = this.app.vault.getMarkdownFiles();
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
            const content = await this.app.vault.cachedRead(file);
            const lower = content.toLowerCase();

            for (const query of normalizedQueries) {
              if (lower.includes(query)) {
                matches.add(file.path);
                break;
              }
            }
          } catch (error) {
            // Skip files that can't be read
            logInfo(`GrepScanner: Skipping file ${file.path}: ${error}`);
          }
        })
      );

      // Yield on mobile to prevent blocking
      if (Platform.isMobile && i % GrepScanner.CONFIG.YIELD_INTERVAL === 0) {
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
   * Check if a file contains any of the queries
   * @param file - The file to check
   * @param queries - Array of queries to search for
   * @returns True if file contains any query
   */
  async fileContainsAny(file: TFile, queries: string[]): Promise<boolean> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const lower = content.toLowerCase();

      return queries.some((query) => lower.includes(query.toLowerCase()));
    } catch {
      return false;
    }
  }
}
