import type { App } from "obsidian";
import type React from "react";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
  EffortOption,
  EnabledModelEntry,
  ModelSelection,
  ModelState,
  ModelWireCodec,
  ModeMapping,
  PermissionOption,
  RawModeState,
  SessionId,
} from "./types";

/** UI-facing install/setup state for a backend. */
export type InstallState =
  | { kind: "absent" }
  | { kind: "checking"; source: "managed" | "custom" }
  | { kind: "ready"; source: "managed" | "custom" }
  | {
      kind: "incompatible";
      source: "managed" | "custom";
      currentVersion: string;
      minVersion: string;
      message: string;
    }
  | { kind: "error"; message: string };

/** Sign-in state for backends that authenticate via a CLI / external account. */
export interface BackendAuthStatus {
  signedIn: boolean;
  /** Display string for a signed-in account, e.g. `"zero@x.com (max)"`. */
  label?: string;
}

/** Progress callbacks for an interactive sign-in flow. */
export interface BackendSignInHandlers {
  /** The OAuth URL to surface as a clickable browser-open fallback. */
  onUrl?: (url: string) => void;
  /** Per-line progress from the sign-in subprocess. */
  onLine?: (line: string) => void;
}

/**
 * Backend-confirmed state available while applying a selection. Startup passes
 * the state returned by `newSession`; ordinary picker changes omit the context
 * and compare against the session's in-memory snapshot.
 */
export interface ApplySelectionContext {
  backendReportedCurrent: ModelSelection | null;
}

/**
 * Optional auth capability. Backends whose readiness depends on an external
 * sign-in (the Claude CLI's login state) implement this so generic `ui/` can
 * surface a "Sign in" CTA without knowing the backend's auth mechanism.
 */
export interface BackendAuth {
  /** Probe current sign-in state (may spawn the CLI). */
  getStatus(settings: CopilotSettings): Promise<BackendAuthStatus>;
  /** Run the interactive sign-in flow; resolves with the post-login state. */
  signIn(settings: CopilotSettings, handlers?: BackendSignInHandlers): Promise<BackendAuthStatus>;
}

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
   * Whether this backend routes through infrastructure the user controls.
   * `true` for self-hostable backends (opencode); `false` for cloud agents
   * (Claude, Codex). Required — not optional — so every new backend makes an
   * explicit privacy decision.
   *
   * Self-Host Mode is a presentation label: cloud backends stay visible and
   * selectable, but `backendNeedsSelfHostWarning` uses this flag to mark them
   * with a cloud-egress warning (and the UI sorts them last). It never gates
   * spawning or rewrites settings.
   */
  readonly selfHostable: boolean;

  /**
   * Whether this backend can run the Copilot-hosted models. `true` for backends
   * that route Copilot's provider (opencode); `false` for agents that bring
   * their own models from their own subscription (Claude Code, Codex).
   *
   * Read when no license is active, to decide whose section previews the locked
   * Copilot lineup — which is why it cannot be derived from the configured
   * models: without a license there is no Copilot provider to inspect.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly routesCopilotModels: boolean;

  /**
   * One-paragraph pitch shown beside this backend in the agent select view:
   * which models the user gets from it, and whose plan pays for them. That
   * trade-off is the only thing separating the agents from a user's point of
   * view, so every backend must state it.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly setupDescription: string;

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
   * Mode built-in system prompt changes. Set for backends (opencode, codex)
   * that bake the composed prompt into spawn-time config and share one
   * subprocess across sessions.
   *
   * The Claude SDK adapter re-reads the composed prompt per `newSession()`, so
   * a new chat already picks up the change without a restart — it sets this to
   * `false`.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly restartOnSystemPromptChange: boolean;

  /**
   * When true, this backend runs its own title-summarizer agent and returns a
   * clean conversation title via `session/list` / a pushed `session_info_update`
   * (opencode). The session trusts those titles.
   *
   * When false (codex, Claude Code), the backend has no usable title source:
   * codex names a session after the raw first prompt, leaking the injected
   * `<copilot-context>` envelope, and the Claude SDK exposes no title API. For
   * these the session derives the tab title client-side from the user's first
   * visible message and ignores any backend-provided title.
   *
   * Required (not optional) so a new backend must make an explicit decision.
   */
  readonly summarizesSessionTitle: boolean;

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
   * Optional: actions rendered inline in the settings row while this backend is
   * absent, in place of the generic Configure button. Backends the plugin can
   * install itself own their whole first-run path (download, progress, cancel,
   * adopting an existing binary), so the user never has to open a dialog to get
   * started. Backends that only document an external install omit it and keep
   * the Configure button.
   */
  AbsentInstallActions?: React.ComponentType<{ plugin: CopilotPlugin }>;

  /**
   * Optional: upgrade the installed binary in place (managed reinstall, or the
   * CLI's own `upgrade`). Resolves when done. Changing the persisted version
   * restarts the backend via the `subscribeInstallState` subscription, so the
   * next session boots on the new binary. Throws with a readable message on
   * failure; callers surface progress/errors.
   */
  upgrade?(plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: sign-in capability for backends gated on an external account
   * (e.g. the Claude CLI's login state). When present, generic UI surfaces a
   * "Sign in" CTA while signed-out. Absent backends are assumed always-ready
   * once installed.
   */
  auth?: BackendAuth;

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
   * Optional: adapt a backend-native permission option for generic UI
   * presentation. The option id remains the backend's executable decision;
   * backends may separate wire-level rule prose from a compact action label.
   *
   * @param option - The neutral permission option produced at the backend boundary.
   * @param metadata - Opaque backend metadata forwarded unchanged from the ACP option.
   */
  presentPermissionOption?(option: PermissionOption, metadata: unknown): PermissionOption;

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
  applySelection(
    session: AgentSession,
    selection: ModelSelection,
    context?: ApplySelectionContext
  ): Promise<void>;

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
   * Optional: replay persisted state before a newly created or resumed session
   * becomes ready for user input. `seededSelection` is the exact (model, effort)
   * used for a fresh session; it is absent on resume because the existing
   * backend session supplies its model. A transient cross-backend pick carries
   * the user's drafted effort here, which must win over the backend's persisted
   * default so the pick isn't overwritten on startup.
   */
  applyInitialSessionConfig?(
    session: AgentSession,
    settings: CopilotSettings,
    seededSelection?: ModelSelection
  ): Promise<void>;

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
   * Optional: the backend's enabled models with display metadata and per-model
   * credential health — the single accessor the chat picker drives its section
   * from. The picker iterates this set (showing every enabled model, flagging
   * those the agent can't serve) rather than a reported∩enabled intersection,
   * so a model the agent dropped for a missing/expired key — or one it no
   * longer reports at all — is never silently hidden. The signature is limited
   * to `CopilotSettings` so `session/` stays free of `@/modelManagement` — the
   * backend implements the join. Agent-native backends (claude, codex) report
   * `credentialState: "ok"` for every entry; key-bearing BYOK backends
   * (opencode) compute real per-model health. `null` opts out: the picker then
   * keeps only the active session's selection.
   */
  getEnabledModelEntries?(settings: CopilotSettings): EnabledModelEntry[] | null;

  /**
   * Optional: this backend's wire base id for one configured model, or `null`
   * when it cannot route that model's provider at all. Answers "can you run
   * this, and under what id?" from the provider alone, deliberately ignoring
   * whether the model is enabled — enrollment is a separate, later write (see
   * `CopilotPlusSetupApi.#reconcileModels`), so a caller acting the moment a
   * model is configured must not have to race it. Only backends that route
   * Copilot-side providers implement this; agent-native ones (claude, codex)
   * omit it, which reads as "not mine".
   */
  getWireBaseId?(configuredModelId: string, settings: CopilotSettings): string | null;

  /**
   * Optional: persist the probe sessionId returned by a successful
   * `session/new` probe so the next plugin load can reuse it via
   * `resumeSession` or `loadSession`. Only called by `AgentModelPreloader`.
   */
  persistProbeSessionId?(sessionId: string, plugin: CopilotPlugin): Promise<void>;

  /**
   * Optional: eagerly discover each enabled model's effort options right after
   * the initial catalog probe. opencode only reports a model's effort as a
   * `category:"thought_level"` config option once that model is the *active*
   * model, so the catalog carries no per-model effort and the only way to learn
   * a non-active model's effort is to switch to it. Runs on the existing probe
   * `sessionId` (cheap: a switch is ~ms, a new session is ~1s) and MUST restore
   * `modelState.current` before returning so the session the manager adopts is
   * never left on a probed model. Returns baseModelId → effortOptions for models
   * that expose effort. Best-effort; `AgentModelPreloader` swallows failures.
   */
  prefetchEffortCatalog?(args: {
    proc: BackendProcess;
    sessionId: SessionId;
    modelState: ModelState;
    enabledModels: ReadonlyArray<EnabledModelEntry>;
    isAborted: () => boolean;
  }): Promise<Record<string, EffortOption[]>>;
}
