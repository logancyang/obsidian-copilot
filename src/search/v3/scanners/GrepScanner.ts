import { logInfo } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App } from "obsidian";

export class GrepScanner {
  private static readonly CONFIG = {
    BATCH_SIZE: 30,
    YIELD_INTERVAL: 100,
  } as const;

  constructor(private app: App) {}

  async batchCachedReadGrep(queries: string[], limit: number): Promise<string[]> {
    const { inclusions, exclusions } = getMatchingPatterns();

    const allFiles = this.app.vault.getMarkdownFiles();
    const files = allFiles.filter((file) =>
      shouldIndexFile(this.app, file, inclusions, exclusions)
    );
    const batchSize = GrepScanner.CONFIG.BATCH_SIZE;

    const normalizedQueries = queries
      .map((q) => q.toLowerCase())
      .filter((q) => this.isGrepWorthy(q));

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

      if (i > 0 && i % yieldInterval === 0) {
        await new Promise((r) => window.setTimeout(r, 0));
      }
    }

    pathMatchesWithScore.sort((a, b) => b.matchCount - a.matchCount);
    const pathMatches = new Set(pathMatchesWithScore.map((m) => m.path));

    const contentLimit = Math.max(0, limit - pathMatches.size);
    const contentMatches = new Set<string>();

    if (contentLimit > 0) {
      for (let i = 0; i < files.length && contentMatches.size < contentLimit; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (file) => {
            if (contentMatches.size >= contentLimit) return;
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
              logInfo(`GrepScanner: Skipping file ${file.path}: ${error}`);
            }
          })
        );

        if (i % GrepScanner.CONFIG.YIELD_INTERVAL === 0) {
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
    }

    const results = [...pathMatches, ...contentMatches].slice(0, limit);
    if (results.length > 0) {
      const pathCount = Math.min(pathMatches.size, limit);
      const contentCount = results.length - pathCount;
      logInfo(
        `  Grep: ${results.length} files match (${pathCount} path, ${contentCount} content) [${queries.slice(0, 3).join(", ")}${queries.length > 3 ? "..." : ""}]`
      );
    }

    return results;
  }

  async grep(query: string, limit: number = 200): Promise<string[]> {
    return this.batchCachedReadGrep([query], limit);
  }

  private isGrepWorthy(term: string): boolean {
    if (!term || term.length <= 1) {
      return false;
    }
    return true;
  }
}
