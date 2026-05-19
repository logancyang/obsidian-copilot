import type { App } from "obsidian";
import type React from "react";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendConfigOption,
  BackendId,
  BackendModelInfo,
  BackendProcess,
  CopilotMode,
  ModelSelection,
  ModelWireCodec,
  ModeMapping,
  RawModeState,
} from "./types";

/** UI-facing install/setup state for a backend. */
export type InstallState =
  | { kind: "absent" }
  | { kind: "ready"; source: "managed" | "custom" }
  | { kind: "error"; message: string };

/**
 * Backend-agnostic descriptor consumed by `session/` and `ui/`. Each backend
 * exports one of these from its own folder; the registry maps `BackendId →
 * BackendDescriptor`. Adding a new backend is exactly: implement
 * `createBackendProcess`, export a `BackendDescriptor`, register it. No
 * edits to session or UI.
 */
export interface BackendDescriptor {
  readonly id: BackendId;
  readonly displayName: string;

  /**
   * Brand icon component for this backend. Rendered in the session tab strip
   * and anywhere else the UI surfaces backend identity. Should accept a
   * `className` for sizing/coloring and use `currentColor` for fill so it
   * adopts the surrounding theme color.
   */
  readonly Icon: React.ComponentType<{ className?: string }>;

  /**
   * Project-relative POSIX path of the directory this backend reads skills
   * from. No leading slash. The symlink fanout writes
   * `<vault>/<skillsProjectDir>/<skill-name>` for every enabled skill.
   */
  readonly skillsProjectDir: string;

  /**
   * Other backends whose skill directories this backend also loads skills
   * from at spawn time, beyond its own `skillsProjectDir`. Drives the deny
   * list for cross-discovered managed skills (see
   * `skills/denyListComposer.ts`).
   *
   * Required (not optional) so a new backend must make an explicit decision.
   * `[]` is the right answer when there is no cross-discovery surface.
   */
  readonly crossDiscoveredAgents: ReadonlyArray<BackendId>;

  /**
   * When true, the host restarts this backend whenever the effective managed
   * skill set changes. Set for backends (opencode) whose native skill-command
   * cache is built at spawn and won't otherwise pick up symlink fanout changes.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly restartOnManagedSkillsChange: boolean;

  /** Sync read of install/setup state from settings + last-known disk reconcile. */
  getInstallState(settings: CopilotSettings): InstallState;

  /** Subscribe to settings/disk changes affecting install state. Returns unsubscribe. */
  subscribeInstallState(plugin: CopilotPlugin, cb: () => void): () => void;

  /** Open backend-specific install/setup modal. */
  openInstallUI(plugin: CopilotPlugin): void;

  /**
   * Construct the backend process the session manager will drive. ACP-style
   * backends typically delegate to `simpleBinaryBackendProcess` from
   * `backends/shared/`, which wraps `AcpBackendProcess` around an
   * `AcpBackend` spawn descriptor. In-process adapters (e.g. the Claude
   * Agent SDK) construct their own `BackendProcess` implementation directly.
   *
   * `descriptor` is the descriptor itself — passed back so the backend
   * process can call dispatch hooks (`getModeMapping`, `wire.decode`,
   * `wire.encode`, `wire.effortConfigFor`) when producing `BackendState`
   * from its native catalogs.
   */
  createBackendProcess(args: {
    plugin: CopilotPlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
  }): BackendProcess;

  /** Optional: backend-specific settings panel. Rendered inside the Agent Mode tab. */
  SettingsPanel?: React.FC<{ plugin: CopilotPlugin; app: App }>;

  /** Optional: reconcile install state on plugin load (e.g. clear stale managed install). */
  onPluginLoad?(plugin: CopilotPlugin): Promise<void>;

  /**
   * Wire-format codec for this backend's model ids. The single point of
   * truth for "how does this backend pack model+effort into one
   * `RawModelState.availableModels[].modelId` string." Used at the
   * agent boundary by the translator (decode incoming catalog) and the
   * session manager (encode outgoing `setSessionModel`); never invoked
   * by the application layer.
   */
  readonly wire: ModelWireCodec;

  /**
   * Apply a (baseModelId, effort) selection to a live session. The descriptor
   * decides whether effort travels in the wire model id (suffix-style
   * backends: codex, opencode) or via a separate `setConfigOption` call
   * (descriptor-style: Claude SDK).
   *
   * `effort: null` means "default" — descriptor-style backends typically
   * no-op the effort dispatch on null (no "clear to default" config call
   * exists); suffix-style backends encode the null and re-emit the bare
   * model id.
   *
   * Implementations are expected to swallow `MethodUnsupportedError` from
   * the underlying `session.setConfigOption` call (the backend may simply
   * lack the capability) and propagate everything else.
   */
  applySelection(session: AgentSession, selection: ModelSelection): Promise<void>;

  /**
   * Optional: return the canonical → native mode mapping for this backend
   * given the current session state. Returning `null` hides the mode picker
   * for this backend. The mode adapter dispatches on `mapping.kind` to pick
   * between "set mode" and "set config option" channels.
   */
  getModeMapping?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): ModeMapping | null;

  /**
   * Optional: persist the user's chosen mode so the next session can replay
   * it. Called by `AgentSessionManager.persistModeFor`.
   */
  persistModeSelection?(value: CopilotMode, plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: replay persisted state on a freshly created session. Runs
   * once after `createSession` resolves.
   */
  applyInitialSessionConfig?(session: AgentSession, settings: CopilotSettings): Promise<void>;

  /**
   * Optional: identify the backend's own plan-mode plan files. Used by the
   * Claude SDK permission bridge to auto-allow `Write` calls that target
   * backend-owned plan markdown (`~/.claude/plans/*.md`) while rejecting
   * arbitrary built-in writes. No other consumer today.
   *
   * `cwd` is the session's working directory; pass `null` when unknown
   * (the matcher should still recognize absolute data-dir paths).
   */
  isPlanModePlanFilePath?(absolutePath: string, cwd: string | null | undefined): boolean;

  /**
   * Optional: default enable/disable policy for an agent-reported model when
   * the user has no explicit `modelEnabledOverrides` entry. Returning `true`
   * surfaces the model in the chat picker and the settings tab; `false`
   * hides it. Omit to default-enable every agent-reported model.
   *
   * Used as a no-config curation knob — Codex and Opencode advertise large
   * catalogs and we ship with one-model defaults; Claude Code defaults to
   * showing all reported models.
   */
  isModelEnabledByDefault?(model: BackendModelInfo): boolean;

  /**
   * Optional: previously-stored sessionId of the backend's dedicated
   * "probe session", used by `AgentModelPreloader` to enumerate live models
   * across plugin reloads without accumulating one fresh agent-side session
   * record per startup. Returns `undefined` when no probe has run yet.
   */
  getProbeSessionId?(settings: CopilotSettings): string | undefined;

  /**
   * Optional: persist the probe sessionId returned by a successful
   * `session/new` probe so the next plugin load can reuse it via
   * `resumeSession` or `loadSession`. Only called by `AgentModelPreloader`.
   */
  persistProbeSessionId?(sessionId: string, plugin: CopilotPlugin): Promise<void>;
}
