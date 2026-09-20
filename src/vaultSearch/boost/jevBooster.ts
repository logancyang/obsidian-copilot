import { BrevilabsApiError, BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { buildBoostPool, type BoostPoolCandidate } from "@/vaultSearch/boost/boostPool";
import {
  buildJevRequest,
  parseJevProbabilities,
  type JevNoulAnswer,
} from "@/vaultSearch/boost/jevQuestions";
import type { FuzzySearch } from "@/vaultSearch/candidates";
import type { SearchBooster, SearchCandidate, SearchFile } from "@/vaultSearch/types";

export const JEV_TIMEOUT_MS = 5000;
export const JEV_BATCH_SIZE = 30;
export const JEV_MAX_IN_FLIGHT = 8;

interface BrocaClient {
  broca(state: unknown, questions: Record<string, unknown>): Promise<Record<string, JevNoulAnswer>>;
}

interface JevSearchBoosterOptions {
  client: BrocaClient;
  files: SearchFile[];
  selectedTypes: ReadonlySet<string>;
  prepareSearch: (query: string) => FuzzySearch;
  vaultName: string;
  now?: () => Date;
  timerWindow?: Pick<Window, "setTimeout" | "clearTimeout">;
}

interface JudgmentDetails {
  sources: string[];
  miyoRank: number | null;
  jevRank: number;
}

/** Serializes Jev judgments and keeps the paid service outside basic vault search. */
export class JevSearchBooster implements SearchBooster {
  private sequence = 0;
  private inFlight: Promise<void> | null = null;
  private lastDetails = new Map<string, JudgmentDetails>();

  constructor(private readonly options: JevSearchBoosterOptions) {}

  extraCandidates(query: string, types: Set<string>): SearchCandidate[] {
    return this.pool(query, [], types).map(({ candidate }) => candidate);
  }

  async score(query: string, candidates: SearchCandidate[]): Promise<Map<string, number>> {
    const sequence = ++this.sequence;
    if (this.inFlight) await this.inFlight;
    if (sequence !== this.sequence) throw new Error("AI boost superseded by a newer query");

    const pool = this.pool(query, candidates, this.options.selectedTypes);
    if (!pool.length) return new Map();
    const startedAt = Date.now();
    const now = this.now();
    const files = this.filesForTypes(this.options.selectedTypes);
    const batches = chunk(pool, JEV_BATCH_SIZE).slice(0, JEV_MAX_IN_FLIGHT);
    const transports = batches.map((batch) => {
      const request = buildJevRequest(query, this.options.vaultName, batch, files, now);
      return {
        batch,
        estimatedInputTokens: Math.ceil(
          JSON.stringify({ state: request.state, questions: request.questions }).length / 4
        ),
        transport: this.options.client.broca(request.state, request.questions),
      };
    });
    const settledPromise = Promise.allSettled(
      transports.map(({ transport }) => this.withTimeout(transport))
    );
    const tracked = settledPromise.then(() => undefined);
    this.inFlight = tracked;
    void tracked.finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });

    const settled = await settledPromise;
    if (sequence !== this.sequence) throw new Error("AI boost superseded by a newer query");
    const probabilities = new Map<string, number>();
    let fulfilledBatchCount = 0;
    settled.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        logWarn("[Vault search AI boost batch failed]", {
          batch: index + 1,
          status: batchFailureStatus(result.reason),
        });
        return;
      }
      fulfilledBatchCount += 1;
      for (const [path, probability] of parseJevProbabilities(
        transports[index].batch,
        result.value
      )) {
        probabilities.set(path, probability);
      }
    });
    // A fully failed boost must not make basic search scores look like low Jev confidence.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/516
    if (fulfilledBatchCount === 0) throw new Error("AI boost unavailable");
    this.rememberDetails(pool, probabilities);
    const sourceSizes = Object.fromEntries(
      ["miyo", "filename", "attributes", "created", "modified"].map((source) => [
        source,
        pool.filter(({ sources }) => sources.includes(source as never)).length,
      ])
    );
    logInfo("[Vault search AI boost]", {
      queryLength: query.length,
      ...(getSettings().debug ? { query } : {}),
      poolSize: pool.length,
      sourceSizes,
      estimatedInputTokensPerRequest: transports.map(
        ({ estimatedInputTokens }) => estimatedInputTokens
      ),
      estimatedInputTokensPerSearch: transports.reduce(
        (total, { estimatedInputTokens }) => total + estimatedInputTokens,
        0
      ),
      probabilities: Object.fromEntries(probabilities),
      jevLatencyMs: Date.now() - startedAt,
    });
    return probabilities;
  }

  logOpened(path: string): void {
    const details = this.lastDetails.get(path);
    if (details) logInfo("[Vault search AI boost opened]", { path, ...details });
  }

  private pool(
    query: string,
    basicCandidates: SearchCandidate[],
    selectedTypes: ReadonlySet<string>
  ): BoostPoolCandidate[] {
    return buildBoostPool({
      basicCandidates,
      files: this.options.files,
      selectedTypes,
      fuzzySearch: this.options.prepareSearch(query),
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private filesForTypes(selectedTypes: ReadonlySet<string>): SearchFile[] {
    return this.options.files.filter((file) => selectedTypes.has(file.extension));
  }

  private withTimeout<T>(request: Promise<T>): Promise<T> {
    const timerWindow = this.options.timerWindow ?? window;
    return new Promise<T>((resolve, reject) => {
      const timer = timerWindow.setTimeout(
        () => reject(new Error("AI boost timed out")),
        JEV_TIMEOUT_MS
      );
      request.then(
        (value) => {
          timerWindow.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          timerWindow.clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  private rememberDetails(
    pool: BoostPoolCandidate[],
    probabilities: ReadonlyMap<string, number>
  ): void {
    this.lastDetails.clear();
    [...probabilities]
      .sort(([, left], [, right]) => right - left)
      .forEach(([path], index) => {
        const entry = pool.find(({ candidate }) => candidate.path === path);
        if (entry) {
          this.lastDetails.set(path, {
            sources: entry.sources,
            miyoRank: entry.searchRank,
            jevRank: index + 1,
          });
        }
      });
  }
}

function batchFailureStatus(reason: unknown): number | string {
  if (reason instanceof BrevilabsApiError) return reason.status;
  if (reason instanceof Error && reason.message === "AI boost timed out") return "timed out";
  return reason instanceof Error ? reason.message : String(reason);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function createJevSearchBooster(
  options: Omit<JevSearchBoosterOptions, "client">
): JevSearchBooster {
  return new JevSearchBooster({
    ...options,
    client: BrevilabsClient.getInstance(),
  });
}
