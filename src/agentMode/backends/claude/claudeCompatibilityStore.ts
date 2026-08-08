import type { InstallState } from "@/agentMode/session/types";
import {
  probeClaudeVersion,
  type ClaudeVersionRunner,
} from "@/agentMode/backends/claude/claudeVersion";

export interface ClaudeCompatibilityInput {
  cacheKey: string;
  path: string;
  source: "managed" | "custom";
  env: NodeJS.ProcessEnv;
}

interface RefreshOptions {
  force?: boolean;
  run?: ClaudeVersionRunner;
}

type Listener = () => void;

const CHECKING_STATES = Object.freeze({
  managed: Object.freeze({ kind: "checking", source: "managed" }),
  custom: Object.freeze({ kind: "checking", source: "custom" }),
}) satisfies Readonly<Record<ClaudeCompatibilityInput["source"], InstallState>>;

/**
 * Owns transient, device-local compatibility state for selected Claude Code runtimes.
 *
 * It coordinates readiness checks and change notifications by runtime identity
 * so UI and session startup share one current answer. Executable selection,
 * persistence, and user-facing recovery remain the responsibility of callers.
 */
export class ClaudeCompatibilityStore {
  private readonly states = new Map<string, InstallState>();
  private readonly inflight = new Map<string, Promise<InstallState>>();
  private readonly listeners = new Set<Listener>();

  /**
   * Gives synchronous consumers the latest readiness answer without starting a
   * compatibility check.
   * @param input - The runtime identity and installation source whose readiness should be read.
   */
  get(input: ClaudeCompatibilityInput): InstallState {
    return this.states.get(input.cacheKey) ?? CHECKING_STATES[input.source];
  }

  /**
   * Brings one runtime's readiness up to date after installation or configuration changes.
   * @param input - The runtime identity, executable, and environment that should be checked.
   * @param options - The cache policy and command runner that should govern the check.
   */
  refresh(input: ClaudeCompatibilityInput, options: RefreshOptions = {}): Promise<InstallState> {
    const running = this.inflight.get(input.cacheKey);
    if (running) return running;

    const cached = this.states.get(input.cacheKey);
    if (!options.force && cached && cached.kind !== "checking") return Promise.resolve(cached);

    this.set(input.cacheKey, CHECKING_STATES[input.source]);
    const promise = probeClaudeVersion(input.path, input.env, options.run)
      .then((compatibility): InstallState => {
        if (compatibility.kind === "supported") {
          return { kind: "ready", source: input.source };
        }
        return { ...compatibility, source: input.source };
      })
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
   * Keeps readiness consumers synchronized with compatibility transitions
   * without exposing probe lifecycle details.
   * @param listener - The consumer to notify whenever a runtime's readiness changes.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(key: string, state: InstallState): void {
    this.states.set(key, state);
    for (const listener of this.listeners) listener();
  }
}

export const claudeCompatibilityStore = new ClaudeCompatibilityStore();
