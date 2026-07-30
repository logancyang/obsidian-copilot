import type { InstallState } from "@/agentMode/session/types";

export interface CompatibilityStoreInput {
  cacheKey: string;
  source: "managed" | "custom";
}

export interface CompatibilityRefreshOptions {
  force?: boolean;
}

type Listener = (cacheKey: string) => void;

const CHECKING_STATES = Object.freeze({
  managed: Object.freeze({ kind: "checking", source: "managed" }),
  custom: Object.freeze({ kind: "checking", source: "custom" }),
}) satisfies Readonly<Record<CompatibilityStoreInput["source"], InstallState>>;

/**
 * Owns transient compatibility state for a selected backend runtime.
 *
 * Backend-specific callers supply only the probe that interprets their
 * executable. This class owns stable snapshots, per-runtime caching,
 * concurrent-probe deduplication, and subscriber publication.
 */
export class CompatibilityStore<
  Input extends CompatibilityStoreInput,
  Options extends CompatibilityRefreshOptions = CompatibilityRefreshOptions,
> {
  private readonly states = new Map<string, InstallState>();
  private readonly inflight = new Map<string, Promise<InstallState>>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly probe: (input: Input, options: Options) => Promise<InstallState>) {}

  /**
   * Gives synchronous consumers the latest readiness answer without starting a probe.
   * @param input - The selected runtime identity whose readiness should be read.
   */
  get(input: Input): InstallState {
    return this.states.get(input.cacheKey) ?? CHECKING_STATES[input.source];
  }

  /**
   * Brings one runtime's readiness up to date and publishes its transitions.
   * @param input - The selected runtime identity and backend-specific probe input.
   * @param options - The cache policy and backend-specific probe options.
   */
  refresh(input: Input, options: Options = {} as Options): Promise<InstallState> {
    const running = this.inflight.get(input.cacheKey);
    if (running) return running;

    const cached = this.states.get(input.cacheKey);
    if (!options.force && cached && cached.kind !== "checking") return Promise.resolve(cached);

    this.set(input.cacheKey, CHECKING_STATES[input.source]);
    const promise = this.probe(input, options)
      .catch(
        (error): InstallState => ({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      )
      .then((state) => {
        this.set(input.cacheKey, state);
        return state;
      })
      .finally(() => this.inflight.delete(input.cacheKey));

    this.inflight.set(input.cacheKey, promise);
    return promise;
  }

  /**
   * Keeps readiness consumers synchronized with compatibility transitions.
   * @param listener - The consumer to notify with the runtime key that changed.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(key: string, state: InstallState): void {
    this.states.set(key, state);
    for (const listener of this.listeners) listener(key);
  }
}
