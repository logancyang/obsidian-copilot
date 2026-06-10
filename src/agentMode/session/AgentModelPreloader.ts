import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { App, FileSystemAdapter, Platform } from "obsidian";
import { MethodUnsupportedError } from "./errors";
import { backendStateSignature } from "./translateBackendState";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  EffortOption,
  SessionId,
} from "./types";

/**
 * Warm result of a successful preload — the still-running backend process,
 * the probe session id it owns, and the state snapshot it reported. Handed
 * off via `takeWarm()` so the manager can skip a fresh subprocess spawn +
 * `initialize` handshake on the first chat open. The manager reuses the
 * process but starts its own `newSession` for the chat — the probe session
 * is never adopted as a user chat, since opencode persists and resumes it
 * (transcript and title intact) and reusing it would leak a prior
 * conversation into a supposedly fresh chat. `state` still seeds the picker.
 */
export interface WarmBackend {
  proc: BackendProcess;
  probeSessionId: SessionId;
  state: BackendState;
}

/**
 * Plugin-lifetime cache of per-backend session state and the running probe
 * subprocess that produced it. Backends expose `BackendState` only as a
 * side-effect of session creation / resume / load, so without this preload
 * the picker would show no entries for non-active backends and would blink
 * empty during the round-trip on a fresh session.
 *
 * Probes once per backend at startup: prefer resume of a persisted probe
 * sessionId, fall back to load, then to new (and persist the new id so the
 * next reload can reuse it — keeps the agent-side session store at one stale
 * entry per machine instead of growing with each reload).
 *
 * The probe subprocess is **kept warm** until the manager consumes it via
 * `takeWarm(backendId)`. That removes the warm subprocess spawn from the
 * critical path of the first chat-open: instead of preload booting a
 * subprocess just to read its catalog and immediately shutting it down,
 * the same subprocess becomes the manager's backend process on first use.
 */
export class AgentModelPreloader {
  private readonly warm = new Map<BackendId, WarmBackend>();
  // State-only cache for backends whose warm entry has already been
  // consumed (or that pushed updates after consumption via `setCached`).
  // The active session's `attachModelCacheSync` writes here.
  private readonly cache = new Map<BackendId, BackendState>();
  // Per-backend effort options keyed by baseModelId, discovered by probing each
  // enabled model once after the catalog loads (opencode only advertises effort
  // for the active model, so the catalog itself carries none). Read by the
  // picker via `AgentSessionManager.getEffortCatalog`.
  private readonly effortCatalog = new Map<BackendId, Record<string, EffortOption[]>>();
  private readonly inflight = new Map<BackendId, Promise<void>>();
  // Backends whose in-flight probe baked stale spawn config and must re-probe
  // once it settles. Set by `refresh`, drained by the probe chain. Coalesces
  // the burst of config writes one BYOK save produces into a single re-probe.
  private readonly pendingRefresh = new Set<BackendId>();
  private readonly listeners = new Set<() => void>();
  // Per-warm-entry exit-listener teardowns. Wired when the warm entry is
  // recorded so we can clear it if the probe subprocess dies before the
  // manager takes ownership.
  private readonly warmExitUnsubs = new Map<BackendId, () => void>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin,
    private readonly resolveDescriptor: (id: BackendId) => BackendDescriptor | undefined
  ) {}

  getCachedBackendState(backendId: BackendId): BackendState | null {
    return this.warm.get(backendId)?.state ?? this.cache.get(backendId) ?? null;
  }

  /** Per-model effort options discovered by the post-catalog prefetch, or null. */
  getEffortCatalog(backendId: BackendId): Record<string, EffortOption[]> | null {
    return this.effortCatalog.get(backendId) ?? null;
  }

  /**
   * Replace the cached entry for `backendId`. No-op when the signature
   * is unchanged, to avoid spurious picker rebuilds. Live sessions push
   * here via `attachModelCacheSync` after the warm entry is consumed.
   */
  setCached(backendId: BackendId, state: BackendState): void {
    if (this.disposed) return;
    const prev = this.getCachedBackendState(backendId);
    if (backendStateSignature(prev) === backendStateSignature(state)) return;
    this.cache.set(backendId, state);
    this.notify();
  }

  /**
   * Remove all cached state for `backendId` after its backend is restarted.
   * Drops the warm subprocess if it hasn't been taken yet so a fresh probe
   * runs on the next `preload(backendId)` call.
   */
  clearCached(backendId: BackendId): void {
    if (this.disposed) return;
    let changed = this.cache.delete(backendId);
    if (this.effortCatalog.delete(backendId)) changed = true;
    const warm = this.warm.get(backendId);
    if (warm) {
      this.warm.delete(backendId);
      this.warmExitUnsubs.get(backendId)?.();
      this.warmExitUnsubs.delete(backendId);
      // Best-effort shutdown of the abandoned warm proc.
      warm.proc.shutdown().catch((e) => {
        logWarn(`[AgentMode] preload clearCached: shutdown of warm ${backendId} failed`, e);
      });
      changed = true;
    }
    if (changed) this.notify();
  }

  /**
   * Hand the warm backend (process + probe session id + state snapshot) to
   * the manager. Single-shot: removes the entry so subsequent callers see
   * `null` and the manager owns lifetime of the process from here on.
   */
  takeWarm(backendId: BackendId): WarmBackend | null {
    const entry = this.warm.get(backendId);
    if (!entry) return null;
    this.warm.delete(backendId);
    this.warmExitUnsubs.get(backendId)?.();
    this.warmExitUnsubs.delete(backendId);
    // Keep the last-known state in `cache` so the picker still reads it
    // until the live session syncs its own state back in. Without this the
    // picker would briefly see `null` between `takeWarm` and the first
    // `attachModelCacheSync` write.
    this.cache.set(backendId, entry.state);
    return entry;
  }

  /**
   * Snapshot of the still-warm probe processes, for read-only RPC sweeps
   * (the history surface's `listSessions`). Unlike {@link takeWarm} this
   * does NOT consume the entries — the preloader keeps ownership, and the
   * manager can still adopt the proc later.
   */
  getWarmProcs(): Array<{ backendId: BackendId; proc: BackendProcess }> {
    return Array.from(this.warm.entries(), ([backendId, entry]) => ({
      backendId,
      proc: entry.proc,
    }));
  }

  /** Best-effort probe; failures are logged and swallowed. Dedupes per backend. */
  preload(backendId: BackendId): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.inflight.get(backendId);
    if (existing) return existing;
    return this.startProbeChain(backendId);
  }

  /**
   * Re-probe `backendId` against current settings after a spawn-config change
   * (a new API key, an enabled-models edit, …). Unlike {@link preload} — whose
   * dedupe is right for "ensure a warm proc exists" — a config change may land
   * *after* an in-flight probe baked its spawn config, so that probe would
   * cache a stale catalog and the picker would flag the freshly-enabled model
   * "not offered by agent" until a reload.
   *
   * A single BYOK save lands several writes (provider row → key → enabled
   * models) in a burst, each calling here. The first drops the warm entry and
   * starts a fresh probe; the rest just flag a trailing re-run, so exactly one
   * more probe runs once the in-flight one finishes — observing the settled
   * settings. This coalesces the burst into a single final re-probe without a
   * debounce timer.
   *
   * Returns the probe-chain promise (for preload-status wiring), or `null` when
   * nothing is warm or in flight — a config change for a never-probed backend
   * must not spin one up.
   */
  refresh(backendId: BackendId): Promise<void> | null {
    if (this.disposed) return null;
    const existing = this.inflight.get(backendId);
    if (existing) {
      this.pendingRefresh.add(backendId);
      return existing;
    }
    if (this.getCachedBackendState(backendId) === null) return null;
    this.clearCached(backendId);
    return this.startProbeChain(backendId);
  }

  /**
   * Track a probe as one in-flight promise so concurrent callers dedupe against
   * the whole chain, including any trailing re-runs requested via
   * {@link refresh}.
   */
  private startProbeChain(backendId: BackendId): Promise<void> {
    const promise = this.runProbeChain(backendId).finally(() => {
      this.inflight.delete(backendId);
      this.pendingRefresh.delete(backendId);
    });
    this.inflight.set(backendId, promise);
    return promise;
  }

  private async runProbeChain(backendId: BackendId): Promise<void> {
    let round = 0;
    do {
      this.pendingRefresh.delete(backendId);
      // Later rounds replace a warm entry the prior probe set; drop it first so
      // the abandoned subprocess is shut down rather than leaked.
      if (round > 0) this.clearCached(backendId);
      round += 1;
      await this.runProbe(backendId);
    } while (this.pendingRefresh.has(backendId) && !this.disposed);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  shutdown(): void {
    this.disposed = true;
    this.cache.clear();
    this.effortCatalog.clear();
    this.inflight.clear();
    this.pendingRefresh.clear();
    this.listeners.clear();
    for (const [backendId, warm] of this.warm) {
      this.warmExitUnsubs.get(backendId)?.();
      warm.proc.shutdown().catch((e) => {
        logWarn(`[AgentMode] preload shutdown: warm ${backendId} shutdown failed`, e);
      });
    }
    this.warm.clear();
    this.warmExitUnsubs.clear();
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logWarn("[AgentMode] preload listener threw", e);
      }
    }
  }

  private async runProbe(backendId: BackendId): Promise<void> {
    if (Platform.isMobile) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const cwd = adapter.getBasePath();

    const descriptor = this.resolveDescriptor(backendId);
    if (!descriptor) {
      logWarn(`[AgentMode] preload skipped: unknown backend ${backendId}`);
      return;
    }
    if (descriptor.getInstallState(getSettings()).kind !== "ready") return;

    const proc = descriptor.createBackendProcess({
      plugin: this.plugin,
      app: this.app,
      clientVersion: this.plugin.manifest.version,
      descriptor,
    });

    let probe: { sessionId: SessionId; state: BackendState } | null = null;
    try {
      await proc.start?.();
      const storedId = descriptor.getProbeSessionId?.(getSettings());
      probe = await this.fetchInitialState(proc, descriptor, backendId, storedId, cwd);
    } catch (err) {
      logError(`[AgentMode] preload ${backendId} failed`, err);
    }

    if (this.disposed || !probe || (!probe.state.model && !probe.state.mode)) {
      if (probe) {
        logInfo(`[AgentMode] preload ${backendId}: agent did not report any initial state`);
      }
      try {
        await proc.shutdown();
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: shutdown failed`, e);
      }
      return;
    }

    // Discover each enabled model's effort options before exposing the warm
    // entry. The probe loop switches the probe session's model and restores it,
    // so doing it now (rather than after the manager adopts the session) keeps
    // the adopted session on the original model. Cheap (~ms per switch) and
    // best-effort — failures leave the picker without prefetched effort.
    await this.runEffortPrefetch(backendId, descriptor, proc, probe.sessionId, probe.state);

    // Probe succeeded — retain the running subprocess as a warm entry so
    // the first chat-open can adopt it instead of paying another spawn +
    // initialize round-trip.
    const warm: WarmBackend = {
      proc,
      probeSessionId: probe.sessionId,
      state: probe.state,
    };
    const exitUnsub = proc.onExit(() => {
      if (this.disposed) return;
      // Subprocess died before the manager claimed it. Drop the warm
      // entry; next createSession will spawn a fresh one through the
      // descriptor.
      if (this.warm.get(backendId) === warm) {
        this.warm.delete(backendId);
        this.warmExitUnsubs.delete(backendId);
        this.notify();
      }
    });
    this.warm.set(backendId, warm);
    this.warmExitUnsubs.set(backendId, exitUnsub);
    logProbeResult(backendId, "session probe", probe.state);
    this.notify();
  }

  /**
   * Probe each enabled model's effort options on the just-created probe session
   * via the descriptor's optional `prefetchEffortCatalog`, caching the result so
   * the picker can show effort steppers for every model before one is selected.
   * Best-effort: no hook, no model state, or any error leaves the catalog empty.
   */
  private async runEffortPrefetch(
    backendId: BackendId,
    descriptor: BackendDescriptor,
    proc: BackendProcess,
    sessionId: SessionId,
    state: BackendState
  ): Promise<void> {
    if (!descriptor.prefetchEffortCatalog || !state.model) return;
    const enabledModels = descriptor.getEnabledModelEntries?.(getSettings());
    if (!enabledModels || enabledModels.length === 0) return;
    try {
      const catalog = await descriptor.prefetchEffortCatalog({
        proc,
        sessionId,
        modelState: state.model,
        enabledModels,
        isAborted: () => this.disposed,
      });
      if (this.disposed) return;
      if (Object.keys(catalog).length > 0) this.effortCatalog.set(backendId, catalog);
    } catch (e) {
      logWarn(`[AgentMode] preload ${backendId}: effort prefetch failed`, e);
    }
  }

  private async fetchInitialState(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    storedId: string | undefined,
    cwd: string
  ): Promise<{ sessionId: SessionId; state: BackendState }> {
    type Strategy = {
      label: string;
      sessionId: string;
      run: () => Promise<{ sessionId: string; state: BackendState }>;
    };
    const strategies: Strategy[] = [];
    if (storedId) {
      strategies.push({
        label: `resumed probe session ${storedId}`,
        sessionId: storedId,
        run: () => proc.resumeSession({ sessionId: storedId, cwd, mcpServers: [] }),
      });
      strategies.push({
        label: `loaded probe session ${storedId}`,
        sessionId: storedId,
        run: () => proc.loadSession({ sessionId: storedId, cwd, mcpServers: [] }),
      });
    }

    for (const { label, sessionId, run } of strategies) {
      try {
        // Register a no-op handler before the call so updates emitted
        // during the call are demuxed against this sessionId rather than
        // buffered indefinitely. The manager overrides this with the real
        // handler when it adopts the session.
        proc.registerSessionHandler(sessionId, () => {});
        const resp = await run();
        logInfo(`[AgentMode] preload ${backendId}: ${label}`);
        return { sessionId: resp.sessionId, state: resp.state };
      } catch (err) {
        if (!(err instanceof MethodUnsupportedError)) {
          logWarn(`[AgentMode] preload ${backendId}: ${label} failed (will fall back)`, err);
        }
      }
    }

    const resp = await proc.newSession({ cwd, mcpServers: [] });
    proc.registerSessionHandler(resp.sessionId, () => {});
    logInfo(`[AgentMode] preload ${backendId}: created probe session ${resp.sessionId}`);
    if (descriptor.persistProbeSessionId) {
      try {
        await descriptor.persistProbeSessionId(resp.sessionId, this.plugin);
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: persistProbeSessionId failed`, e);
      }
    }
    return { sessionId: resp.sessionId, state: resp.state };
  }
}

function logProbeResult(backendId: BackendId, label: string, state: BackendState): void {
  const ids = state.model?.availableModels.map((m) => m.baseModelId).join(", ") ?? "";
  const modeOpts = state.mode?.options.map((o) => o.value).join(", ") ?? "";
  const currentBaseId = state.model?.current.baseModelId ?? "-";
  const currentEntry = state.model?.availableModels.find((e) => e.baseModelId === currentBaseId);
  const effortOpts = currentEntry?.effortOptions.map((o) => o.value ?? "default").join(", ") ?? "";
  logInfo(
    `[AgentMode] preload ${backendId} (${label}): models=[${ids}] (current=${currentBaseId}), ` +
      `mode=[${modeOpts}] effort=[${effortOpts}]`
  );
}
