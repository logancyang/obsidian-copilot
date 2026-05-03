import { logError, logInfo, logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import type {
  SessionConfigOption,
  SessionModeState,
  SessionModelState,
} from "@agentclientprotocol/sdk";
import { App, FileSystemAdapter, Platform } from "obsidian";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import type { BackendDescriptor, BackendId, BackendInitialState } from "./types";

export type { BackendInitialState } from "./types";

/**
 * Plugin-lifetime cache of per-backend initial session state. ACP exposes
 * models, modes, and configOptions only as a side-effect of session
 * creation/resume/load, so without this preload the picker would show no
 * entries for non-active backends and would blink empty during the
 * `session/new` round-trip on a fresh session.
 *
 * Probes once per backend at startup: prefer resume of a persisted probe
 * sessionId, fall back to load, then to new (and persist the new id so the
 * next reload can reuse it — keeps the agent-side session store at one stale
 * entry per machine instead of growing with each reload).
 */
export class AgentModelPreloader {
  private readonly cache = new Map<BackendId, BackendInitialState>();
  private readonly inflight = new Map<BackendId, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin,
    private readonly resolveDescriptor: (id: BackendId) => BackendDescriptor | undefined
  ) {}

  getCachedModels(backendId: BackendId): SessionModelState | null {
    return this.cache.get(backendId)?.models ?? null;
  }

  getCachedModes(backendId: BackendId): SessionModeState | null {
    return this.cache.get(backendId)?.modes ?? null;
  }

  getCachedConfigOptions(backendId: BackendId): SessionConfigOption[] | null {
    return this.cache.get(backendId)?.configOptions ?? null;
  }

  /**
   * Mirror a known initial-state snapshot into the cache. Skipping the notify
   * when nothing material changed keeps the picker `useMemo` from rebuilding
   * on every per-turn `onModelChanged` for an unchanged state.
   */
  setCached(backendId: BackendId, partial: Partial<BackendInitialState>): void {
    if (this.disposed) return;
    const prev = this.cache.get(backendId) ?? EMPTY_STATE;
    const next: BackendInitialState = { ...prev, ...partial };
    if (
      isSameOrNull(prev.models, next.models, modelStateSig) &&
      isSameOrNull(prev.modes, next.modes, modeStateSig) &&
      isSameOrNull(prev.configOptions, next.configOptions, configOptionsSig)
    ) {
      return;
    }
    this.cache.set(backendId, next);
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

    // Non-ACP backends (Claude SDK adapter) don't expose a probe-friendly
    // session model — their model list comes from the SDK directly when the
    // first real session starts. Caching whatever the descriptor declares
    // statically (if anything) is the descriptor's responsibility; we simply
    // skip the ACP probe path here.
    if (descriptor.createBackendProcess) {
      const staticState = descriptor.getStaticInitialState?.();
      if (staticState) this.setCached(backendId, staticState);
      return;
    }

    if (!descriptor.createBackend) {
      logWarn(`[AgentMode] preload skipped: ${backendId} declares no backend factory`);
      return;
    }
    const proc = new AcpBackendProcess(
      this.app,
      descriptor.createBackend(this.plugin),
      this.plugin.manifest.version
    );

    try {
      await proc.start();
      const storedId = descriptor.getProbeSessionId?.(getSettings());
      // The probe is read-only — we don't act on session/update frames.
      // A handler is still registered (no-op) for each touched sessionId so
      // notifications the agent emits for the probe session (e.g. claude-
      // agent-acp's session_info_update, or session/load history replay) are
      // silently swallowed instead of logging "unknown session" warnings.
      const snapshot = await this.fetchInitialState(proc, descriptor, backendId, storedId, cwd);
      if (this.disposed) return;
      if (snapshot.models || snapshot.modes || snapshot.configOptions) {
        this.cache.set(backendId, snapshot);
        const ids = snapshot.models?.availableModels.map((m) => m.modelId).join(", ") ?? "";
        const modeIds = snapshot.modes?.availableModes.map((m) => m.id).join(", ") ?? "";
        const cfgIds = snapshot.configOptions?.map((o) => o.id).join(", ") ?? "";
        logInfo(
          `[AgentMode] preload ${backendId}: cached models=[${ids}] (current=${snapshot.models?.currentModelId ?? "-"}), modes=[${modeIds}] (current=${snapshot.modes?.currentModeId ?? "-"}), configOptions=[${cfgIds}]`
        );
        this.notify();
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
    proc: AcpBackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    storedId: string | undefined,
    cwd: string
  ): Promise<BackendInitialState> {
    type ProbeResponse = Partial<BackendInitialState>;
    type Strategy = {
      label: string;
      sessionId: string;
      run: () => Promise<ProbeResponse>;
    };
    const strategies: Strategy[] = [];
    // Probe sessions are non-interactive — boot with no MCP servers to avoid
    // spawning user-configured tool processes for a read-only ping.
    if (storedId && proc.hasCapability("session/resume")) {
      strategies.push({
        label: `resumed probe session ${storedId}`,
        sessionId: storedId,
        run: () => proc.resumeSession({ sessionId: storedId, cwd, mcpServers: [] }),
      });
    }
    if (storedId && proc.hasCapability("session/load")) {
      strategies.push({
        label: `loaded probe session ${storedId}`,
        sessionId: storedId,
        run: () => proc.loadSession({ sessionId: storedId, cwd, mcpServers: [] }),
      });
    }

    const toSnapshot = (resp: ProbeResponse): BackendInitialState => ({
      models: resp.models ?? null,
      modes: resp.modes ?? null,
      configOptions: resp.configOptions ?? null,
    });

    for (const { label, sessionId, run } of strategies) {
      try {
        proc.registerSessionHandler(sessionId, () => {});
        const resp = await run();
        logInfo(`[AgentMode] preload ${backendId}: ${label}`);
        return toSnapshot(resp);
      } catch (err) {
        if (!(err instanceof MethodUnsupportedError)) {
          logWarn(`[AgentMode] preload ${backendId}: ${label} failed (will fall back)`, err);
        }
      }
    }

    // Same reasoning as the resume/load probes above: skip user MCP servers.
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
    return toSnapshot(resp);
  }
}

const EMPTY_STATE: BackendInitialState = { models: null, modes: null, configOptions: null };

function isSameOrNull<T>(a: T | null, b: T | null, sig: (x: T) => string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return sig(a) === sig(b);
}

function modelStateSig(s: SessionModelState): string {
  return `${s.currentModelId}|${s.availableModels.map((m) => `${m.modelId}=${m.name}`).join(",")}`;
}

function modeStateSig(s: SessionModeState): string {
  return `${s.currentModeId}|${s.availableModes.map((m) => m.id).join(",")}`;
}

function configOptionsSig(opts: SessionConfigOption[]): string {
  return opts.map((o) => `${o.id}=${"currentValue" in o ? String(o.currentValue) : ""}`).join(",");
}
