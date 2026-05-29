import type { App } from "obsidian";
import type React from "react";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
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
  /**
   * Stable backend identifier. Doubles as the model-management `AgentType`
   * for agent backends — every agent-discovered model enrolls under this id,
   * and `agentModelDiscovery` narrows it to `AgentType` at that seam.
   */
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

  /**
   * When true, the host restarts this backend whenever provider rows, API
   * keys, or this backend's enabled-models list change. Set for backends
   * (opencode) that bake provider configuration — `apiKey`, `baseURL`, the
   * enabled-model set — into spawn-time config. Without this, editing a key
   * after the subprocess is running silently has no effect: the running
   * process keeps the old (often empty) value and requests fail upstream.
   *
   * Backends that resolve auth out-of-band (codex inherits `codex login` /
   * shell env; the Claude SDK adapter defers to the spawned CLI) set this
   * to `false`.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly restartOnProviderConfigChange: boolean;

  /**
   * When true, the host restarts this backend whenever the effective Agent
   * Mode system prompt changes (the user's selected/default custom prompt or
   * the "Disable builtin system prompt" toggle). Set for backends (opencode,
   * codex) that bake the composed system prompt into spawn-time config and
   * share one subprocess across sessions, so a changed prompt only reaches the
   * agent on the next spawn.
   *
   * The Claude SDK adapter re-reads the composed prompt per `newSession()`, so
   * a new chat already picks up the change without a restart — it sets this to
   * `false`.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly restartOnSystemPromptChange: boolean;

  /** Sync read of install/setup state from settings + last-known disk reconcile. */
  getInstallState(settings: CopilotSettings): InstallState;

  /**
   * Optional: the resolved filesystem path of the binary/executable this
   * backend runs, for display in settings. `null` when not configured or not
   * resolvable. Distinct from install state — purely informational.
   */
  getResolvedBinaryPath?(settings: CopilotSettings): string | null;

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
   * Optional: normalize a backend-reported model display name before it
   * becomes the canonical `ModelEntry.name`. Applied by the translator at
   * the single point that builds the name, so every downstream consumer
   * (chat picker and settings enrollment alike) inherits the same string.
   *
   * Keep transforms robust and anchored — no free-text parsing. Codex uses
   * it to uppercase the inconsistently-cased `gpt` prefix that codex-acp
   * reports (`gpt-5.4` → `GPT-5.4`); most backends omit it.
   */
  normalizeModelName?(name: string): string;

  /**
   * Opt in to surfacing this backend's per-model `description` as the row
   * subtitle in the chat picker and the settings enable list. Set for backends
   * whose catalog is small and curated with meaningful blurbs (claude, codex);
   * left off for flooding catalogs (opencode) where the line is just noise.
   * BYOK/Plus models have no description, so they never show one regardless.
   */
  readonly showModelDescriptions?: boolean;

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
   * Optional: previously-stored sessionId of the backend's dedicated
   * "probe session", used by `AgentModelPreloader` to enumerate live models
   * across plugin reloads without accumulating one fresh agent-side session
   * record per startup. Returns `undefined` when no probe has run yet.
   */
  getProbeSessionId?(settings: CopilotSettings): string | undefined;

  /**
   * Optional: the backend's enabled set as wire baseModelIds, which the chat
   * picker matches against the reported catalog. The signature is limited to
   * `CopilotSettings` so `session/` stays free of `@/modelManagement` — the
   * backend implements the join. `null` opts out: the picker then keeps only
   * the active session's selection.
   */
  getEnabledBaseModelIds?(settings: CopilotSettings): ReadonlySet<string> | null;

  /**
   * Optional: persist the probe sessionId returned by a successful
   * `session/new` probe so the next plugin load can reuse it via
   * `resumeSession` or `loadSession`. Only called by `AgentModelPreloader`.
   */
  persistProbeSessionId?(sessionId: string, plugin: CopilotPlugin): Promise<void>;
}
