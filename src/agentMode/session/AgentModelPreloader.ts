import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { App, FileSystemAdapter, Platform } from "obsidian";
import { MethodUnsupportedError } from "./errors";
import { backendStateSignature } from "./translateBackendState";
import type { BackendDescriptor, BackendId, BackendProcess, BackendState } from "./types";

/**
 * Plugin-lifetime cache of per-backend session state. Backends expose
 * `BackendState` only as a side-effect of session creation / resume / load,
 * so without this preload the picker would show no entries for non-active
 * backends and would blink empty during the round-trip on a fresh session.
 *
 * Probes once per backend at startup: prefer resume of a persisted probe
 * sessionId, fall back to load, then to new (and persist the new id so the
 * next reload can reuse it — keeps the agent-side session store at one stale
 * entry per machine instead of growing with each reload).
 */
export class AgentModelPreloader {
  private readonly cache = new Map<BackendId, BackendState>();
  private readonly inflight = new Map<BackendId, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin,
    private readonly resolveDescriptor: (id: BackendId) => BackendDescriptor | undefined
  ) {}

  getCachedBackendState(backendId: BackendId): BackendState | null {
    return this.cache.get(backendId) ?? null;
  }

  /**
   * Replace the cached entry for `backendId`. No-op when the signature
   * is unchanged, to avoid spurious picker rebuilds.
   */
  setCached(backendId: BackendId, state: BackendState): void {
    if (this.disposed) return;
    const prev = this.cache.get(backendId) ?? null;
    if (backendStateSignature(prev) === backendStateSignature(state)) return;
    this.cache.set(backendId, state);
    this.notify();
  }

  /** Remove the cached entry for `backendId` after its backend is restarted. */
  clearCached(backendId: BackendId): void {
    if (this.disposed) return;
    if (!this.cache.delete(backendId)) return;
    this.notify();
  }

  /** Best-effort probe; failures are logged and swallowed. Dedupes per backend. */
  preload(backendId: BackendId): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.inflight.get(backendId);
    if (existing) return existing;
    const promise = this.runProbe(backendId).finally(() => {
      this.inflight.delete(backendId);
    });
    this.inflight.set(backendId, promise);
    return promise;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  shutdown(): void {
    this.disposed = true;
    this.cache.clear();
    this.inflight.clear();
    this.listeners.clear();
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

    try {
      await proc.start?.();
      const storedId = descriptor.getProbeSessionId?.(getSettings());
      const state = await this.fetchInitialState(proc, descriptor, backendId, storedId, cwd);
      if (this.disposed) return;
      if (state.model || state.mode) {
        this.setCached(backendId, state);
        logProbeResult(backendId, "session probe", state);
      } else {
        logInfo(`[AgentMode] preload ${backendId}: agent did not report any initial state`);
      }
    } catch (err) {
      logError(`[AgentMode] preload ${backendId} failed`, err);
    } finally {
      try {
        await proc.shutdown();
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: shutdown failed`, e);
      }
    }
  }

  private async fetchInitialState(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    storedId: string | undefined,
    cwd: string
  ): Promise<BackendState> {
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
        proc.registerSessionHandler(sessionId, () => {});
        const resp = await run();
        logInfo(`[AgentMode] preload ${backendId}: ${label}`);
        return resp.state;
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
    return resp.state;
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
