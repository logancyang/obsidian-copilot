import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import type { SessionModelState } from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter, Platform } from "obsidian";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import type { BackendDescriptor, BackendId } from "./types";

/**
 * Plugin-lifetime cache of per-backend `availableModels`. ACP exposes models
 * only as a side-effect of session creation/resume/load, so without this
 * preload the picker would show no entries for non-active backends.
 *
 * Probes once per backend at startup: prefer resume of a persisted probe
 * sessionId, fall back to load, then to new (and persist the new id so the
 * next reload can reuse it — keeps the agent-side session store at one stale
 * entry per machine instead of growing with each reload).
 */
export class AgentModelPreloader {
  private readonly cache = new Map<BackendId, SessionModelState>();
  private readonly inflight = new Map<BackendId, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin,
    private readonly resolveDescriptor: (id: BackendId) => BackendDescriptor | undefined
  ) {}

  getCachedModels(backendId: BackendId): SessionModelState | null {
    return this.cache.get(backendId) ?? null;
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

    const proc = new AcpBackendProcess(
      this.app,
      descriptor.createBackend(this.plugin),
      this.plugin.manifest.version
    );

    try {
      await proc.start();
      const storedId = descriptor.getProbeSessionId?.(getSettings());
      // No registerSessionHandler: probe is models-only, so any session/update
      // frames (history replay from session/load) are intentionally dropped.
      const models = await this.fetchModels(proc, descriptor, backendId, storedId, cwd);
      if (this.disposed) return;
      if (models) {
        this.cache.set(backendId, models);
        const ids = models.availableModels.map((m) => m.modelId).join(", ");
        logInfo(
          `[AgentMode] preload ${backendId}: cached ${models.availableModels.length} models (current=${models.currentModelId}, available=[${ids}])`
        );
        this.notify();
      } else {
        logInfo(`[AgentMode] preload ${backendId}: agent did not report any models`);
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

  private async fetchModels(
    proc: AcpBackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    storedId: string | undefined,
    cwd: string
  ): Promise<SessionModelState | null> {
    type Strategy = {
      label: string;
      run: () => Promise<{ models?: SessionModelState | null }>;
    };
    const strategies: Strategy[] = [];
    if (storedId && proc.isResumeSessionSupported()) {
      strategies.push({
        label: `resumed probe session ${storedId}`,
        run: () => proc.resumeSession({ sessionId: storedId, cwd, mcpServers: [] }),
      });
    }
    if (storedId && proc.isLoadSessionSupported()) {
      strategies.push({
        label: `loaded probe session ${storedId}`,
        run: () => proc.loadSession({ sessionId: storedId, cwd, mcpServers: [] }),
      });
    }

    for (const { label, run } of strategies) {
      try {
        const resp = await run();
        logInfo(`[AgentMode] preload ${backendId}: ${label}`);
        return resp.models ?? null;
      } catch (err) {
        if (!(err instanceof MethodUnsupportedError)) {
          logWarn(`[AgentMode] preload ${backendId}: ${label} failed (will fall back)`, err);
        }
      }
    }

    const resp = await proc.newSession({ cwd, mcpServers: [] });
    logInfo(`[AgentMode] preload ${backendId}: created probe session ${resp.sessionId}`);
    if (descriptor.persistProbeSessionId) {
      try {
        await descriptor.persistProbeSessionId(resp.sessionId, this.plugin);
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: persistProbeSessionId failed`, e);
      }
    }
    return resp.models ?? null;
  }
}
