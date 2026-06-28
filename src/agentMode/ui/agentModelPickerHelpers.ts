import { Notice } from "obsidian";
import { logError } from "@/logger";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { backendRegistry } from "@/agentMode/backends/registry";
import { getModelKeyFromModel } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import type {
  BackendDescriptor,
  BackendId,
  BackendState,
  EffortOption,
  EnabledModelCredentialState,
  EnabledModelEntry,
  ModelEntry,
  ModelState,
} from "@/agentMode/session/types";
import type { AgentModelPickerOverride } from "./useAgentModelPicker";

/** Frozen empty effort list — referential stability for the "no effort" case. */
export const EMPTY_EFFORT_OPTIONS = Object.freeze([]) as unknown as EffortOption[];

/**
 * Right-side flag for an enabled model whose provider has no API key. Shared
 * with the settings default-model picker so the two pickers never diverge.
 */
export const MISSING_KEY_LABEL = "Add API key";

/**
 * Pick the BackendState that should drive the picker's *current selection*
 * display: prefer the active session's live state, fall back to the
 * per-backend preloader cache only when the session has nothing reportable
 * yet (e.g. the brief "starting" window). The cache is shared across every
 * session on the same backend, so reading it directly leaks a sibling
 * tab's most recent setModel into this tab's picker.
 */
export function resolveActiveDisplayState(
  activeSessionState: BackendState | null,
  activeBackendId: BackendId | null,
  getCachedBackendState: (id: BackendId) => BackendState | null
): BackendState | null {
  if (activeSessionState) return activeSessionState;
  if (!activeBackendId) return null;
  return getCachedBackendState(activeBackendId);
}

/**
 * Standard catch handler for picker `apply*` calls. `MethodUnsupportedError`
 * surfaces a targeted notice; anything else is logged and surfaced as a
 * generic failure.
 */
export function handlePickerSwitchError(err: unknown, action: "model" | "effort" | "mode"): void {
  if (err instanceof MethodUnsupportedError) {
    new Notice(`This agent doesn't support runtime ${action} switching.`);
    return;
  }
  logError(`[AgentMode] ${action} apply failed`, err);
  new Notice(`Failed to switch ${action}. See console for details.`);
}

/** A pseudo-provider value used for agent-only synthesized entries. */
export const AGENT_PROVIDER = "agent";

/**
 * Append one backend's section to the picker.
 *
 * One policy for every backend, via `getEnabledModelEntries`: iterate the
 * backend's *enabled* models, enriched by the reported catalog when present.
 * Every enabled model appears — one the agent dropped for a missing key, or
 * no longer reports at all, is shown non-selectable with a flag
 * (`"Add API key"`, `"Not offered by agent"`, …) rather than silently hidden.
 * Agent-native backends (claude, codex) report `credentialState: "ok"`, so
 * their only flag is `"Not offered by agent"` for a stale enabled id.
 *
 * The active session's selection (and an inactive backend's persisted default)
 * is always kept via `keepBaseModelId`. A descriptor that implements no
 * `getEnabledModelEntries` opts out entirely; `buildPickerEntries` still re-adds
 * the active selection if curation stranded it. During preload (no reported
 * catalog yet) we defer to the "Loading…" placeholder `buildPickerEntries`
 * adds, so we don't flag "Not offered by agent" before the catalog loads.
 */
export function appendBackendSection(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  ctx: {
    /** Translator-produced entries from `state.model.availableModels`. */
    backendModels: ReadonlyArray<ModelEntry> | null;
    /** baseModelId of the active session — never filtered out. */
    keepBaseModelId: string | null;
    /** Current settings — read by `getEnabledModelEntries`. */
    settings: CopilotSettings;
  }
): void {
  const enabledEntries = descriptor.getEnabledModelEntries?.(ctx.settings) ?? null;
  if (!enabledEntries) return;
  // Preload still pending → no reported catalog yet; let buildPickerEntries
  // render the Loading placeholder instead of flagging prematurely.
  if (!ctx.backendModels) return;
  appendFromEnabledEntries(
    entries,
    descriptor,
    enabledEntries,
    ctx.backendModels,
    ctx.keepBaseModelId
  );
}

/**
 * Enabled-set-driven section build. Each enabled model becomes a row; the
 * reported catalog enriches its name/description when present. A credential
 * issue (missing key) or "agent didn't offer it" sets
 * `_disabledReason`, which `ModelSelector` renders as a right-side label on a
 * non-selectable row. `keepBaseModelId` (the active/default selection) is
 * appended as a selectable row when it's reported but not already in the
 * enabled set, so curation never strands the running selection.
 */
function appendFromEnabledEntries(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  enabledEntries: ReadonlyArray<EnabledModelEntry>,
  backendModels: ReadonlyArray<ModelEntry>,
  keepBaseModelId: string | null
): void {
  const reportedById = new Map(backendModels.map((m) => [m.baseModelId, m]));
  const emitted = new Set<string>();
  for (const enabled of enabledEntries) {
    const reported = reportedById.get(enabled.baseModelId);
    const name = reported?.name || enabled.name || enabled.baseModelId;
    const subtitle = reported?.description ?? enabled.description;
    const entry = synthesizeAgentEntry(
      enabled.baseModelId,
      name,
      descriptor,
      subtitle,
      enabled.isFree
    );
    const reason = credentialDisabledReason(enabled.credentialState, !!reported);
    if (reason) entry._disabledReason = reason;
    entries.push(entry);
    emitted.add(enabled.baseModelId);
  }

  if (keepBaseModelId && !emitted.has(keepBaseModelId)) {
    const reported = reportedById.get(keepBaseModelId);
    if (reported) {
      entries.push(
        synthesizeAgentEntry(reported.baseModelId, reported.name, descriptor, reported.description)
      );
    }
  }
}

/**
 * Map an enabled model's credential state (+ whether the agent reported it) to
 * a `_disabledReason`, or `undefined` when the row is selectable. Credential
 * problems take precedence over "not offered" — they're the root cause of the
 * agent dropping the model.
 */
function credentialDisabledReason(
  state: EnabledModelCredentialState,
  reported: boolean
): string | undefined {
  if (state === "missing_key") return MISSING_KEY_LABEL;
  if (!reported) return "Not offered by agent";
  return undefined;
}

export function synthesizeAgentEntry(
  baseModelId: string,
  humanName: string,
  descriptor: BackendDescriptor,
  subtitle?: string,
  isFree?: boolean
): ModelSelectorEntry {
  return {
    name: baseModelId,
    provider: AGENT_PROVIDER,
    enabled: true,
    isBuiltIn: false,
    displayName: humanName || baseModelId,
    _group: descriptor.displayName,
    _backendId: descriptor.id,
    _subtitle: subtitle,
    _isFree: isFree,
  };
}

/**
 * Synthesize a non-selectable placeholder row for a backend whose preload
 * hasn't settled yet (status `"pending"`) or failed (status `"error"`).
 * `_disabledReason` is the contract `ModelSelector` / `ModelEffortPicker`
 * use to disable the row and display the right-side label.
 */
export function synthesizePreloadPlaceholder(
  descriptor: BackendDescriptor,
  status: "pending" | "error"
): ModelSelectorEntry {
  const pending = status === "pending";
  return {
    ...synthesizeAgentEntry(
      `__preload_${status}__`,
      pending ? "Loading models…" : "Failed to load",
      descriptor
    ),
    _disabledReason: pending ? "Loading…" : "Unavailable",
  };
}

/**
 * Resolve a picker entry to its baseModelId. All picker entries from agent
 * backends are synthesized — the baseModelId lives in `name`.
 */
export function resolveBaseModelId(entry: ModelSelectorEntry): string | undefined {
  return entry.provider === AGENT_PROVIDER ? entry.name : undefined;
}

/** Bundle of session-derived inputs every model+effort builder needs. */
export interface ModelActiveContext {
  activeSession: AgentSession | null;
  activeChatUIState: AgentChatUIState | null;
  activeBackendId: BackendId | null;
  activeDescriptor: BackendDescriptor | undefined;
  activeSessionHasHistory: boolean;
  activeModelState: ModelState | null;
  activeCurrentEntry: ModelEntry | undefined;
}

export function collectModelActiveContext(manager: AgentSessionManager): ModelActiveContext {
  const activeSession = manager.getActiveSession();
  const activeChatUIState = manager.getActiveChatUIState();
  const activeBackendId = activeSession?.backendId ?? null;
  const activeDescriptor = activeBackendId ? backendRegistry[activeBackendId] : undefined;
  const activeSessionHasHistory = activeSession?.hasUserVisibleMessages() ?? false;
  const activeState = resolveActiveDisplayState(
    activeSession?.getState() ?? null,
    activeBackendId,
    (id) => manager.getCachedBackendState(id)
  );
  const activeModelState = activeState?.model ?? null;
  const activeCurrentEntry = activeModelState?.availableModels.find(
    (e) => e.baseModelId === activeModelState.current.baseModelId
  );
  return {
    activeSession,
    activeChatUIState,
    activeBackendId,
    activeDescriptor,
    activeSessionHasHistory,
    activeModelState,
    activeCurrentEntry,
  };
}

/**
 * Build one entry per registered backend (filtered by overrides and
 * sticky-selection preservation), then locate the active selection. If
 * curation stranded the user's current model, prepend a synthesized entry
 * so it remains visible. Returns the entries array and the resolved
 * `valueKey`.
 */
export function buildPickerEntries(
  manager: AgentSessionManager,
  descriptors: BackendDescriptor[],
  ctx: ModelActiveContext,
  settings: CopilotSettings
): { entries: ModelSelectorEntry[]; valueKey: string } {
  const entries: ModelSelectorEntry[] = [];
  for (const descriptor of descriptors) {
    const isActiveBackend = descriptor.id === ctx.activeBackendId;
    if (!isActiveBackend && ctx.activeSessionHasHistory) continue;
    const cached = manager.getCachedBackendState(descriptor.id);
    const keepBaseModelId = isActiveBackend
      ? (ctx.activeModelState?.current.baseModelId ?? null)
      : (manager.getDefaultSelection(descriptor.id)?.baseModelId ?? null);
    const backendModels = cached?.model?.availableModels ?? null;
    appendBackendSection(entries, descriptor, {
      backendModels,
      keepBaseModelId,
      settings,
    });
    // No catalog cached yet (and not because the agent intentionally
    // omitted a model state). Show a per-backend loading / failure row so
    // the user can see every installed backend immediately — important
    // because the chat now unblocks on just the *active* backend's
    // preload, not the global preload.
    if (!backendModels) {
      const status = manager.getPreloadStatus(descriptor.id);
      if (status === "pending" || status === "error") {
        entries.push(synthesizePreloadPlaceholder(descriptor, status));
      }
    }
  }

  let valueKey = "";
  if (
    ctx.activeBackendId &&
    ctx.activeDescriptor &&
    ctx.activeModelState &&
    ctx.activeCurrentEntry
  ) {
    const baseId = ctx.activeModelState.current.baseModelId;
    const match = entries.find(
      (e) => e._backendId === ctx.activeBackendId && resolveBaseModelId(e) === baseId
    );
    if (match) {
      valueKey = getModelKeyFromModel(match);
    } else {
      const synth = synthesizeAgentEntry(
        baseId,
        ctx.activeCurrentEntry.name,
        ctx.activeDescriptor,
        ctx.activeCurrentEntry.description
      );
      entries.unshift(synth);
      valueKey = getModelKeyFromModel(synth);
    }
  }

  return { entries, valueKey };
}

/**
 * Build the optional effort sibling. Returns `undefined` when the active
 * model has no effort options. `disabled` mirrors
 * `activeChatUIState.canSwitchEffort()` — wire routing
 * (descriptor-style vs suffix-style) lives behind that intent method.
 */
export function buildEffortSibling(
  manager: AgentSessionManager,
  ctx: ModelActiveContext
): AgentModelPickerOverride["effort"] {
  const { activeBackendId, activeCurrentEntry, activeModelState, activeChatUIState } = ctx;
  if (!activeBackendId || !activeCurrentEntry) return undefined;
  if (activeCurrentEntry.effortOptions.length === 0) return undefined;
  if (!activeModelState) return undefined;
  return {
    options: activeCurrentEntry.effortOptions,
    value: activeModelState.current.effort,
    disabled: activeChatUIState?.canSwitchEffort() === false,
    onChange: (value) => {
      manager
        .applySelection({ effort: value }, { expectBackendId: activeBackendId })
        .catch((err) => {
          handlePickerSwitchError(err, "effort");
        });
    },
  };
}

/**
 * Spawn a fresh session on the target backend seeded with the picked
 * (model, effort). The pick is transient — it seeds the new session
 * directly and never writes the backend's persisted default.
 */
function runCrossBackendPick(
  manager: AgentSessionManager,
  oldSessionId: string | undefined,
  targetBackendId: BackendId,
  targetDescriptor: BackendDescriptor,
  baseModelId: string,
  effort: string | null
): void {
  void (async () => {
    try {
      // projectId left default (active scope); the transient pick only seeds the model.
      await manager.createSession(targetBackendId, undefined, { baseModelId, effort });
      manager.setDefaultBackend(targetBackendId);
      if (oldSessionId) {
        void manager
          .closeSession(oldSessionId)
          .catch((e) => logError("[AgentMode] closeSession of empty tab failed", e));
      }
    } catch (err) {
      logError("[AgentMode] cross-backend pick failed", err);
      new Notice(`Failed to start ${targetDescriptor.displayName}. See console for details.`);
    }
  })();
}

/**
 * Build the model picker's `onChange` callback. Cross-backend picks seed
 * a fresh session on the target backend with the chosen model + the
 * target backend's persisted effort (no effort plumbed through the
 * legacy single-arg signature) and close the old empty tab in the
 * background. Same-backend picks route through the running session via
 * `applySelection`. Neither path writes to the saved default selection.
 */
export function buildModelOnChange(
  manager: AgentSessionManager,
  ctx: ModelActiveContext,
  entries: ModelSelectorEntry[]
): (modelKey: string) => void {
  const { activeSession, activeChatUIState } = ctx;
  return (modelKey) => {
    const entry = entries.find((e) => getModelKeyFromModel(e) === modelKey);
    if (!entry) return;
    const targetBackendId = entry._backendId;
    if (!targetBackendId) {
      logError("[AgentMode] picker entry missing _backendId", entry);
      return;
    }
    const targetDescriptor = backendRegistry[targetBackendId];
    if (!targetDescriptor) {
      logError("[AgentMode] picker entry references unknown backend", targetBackendId);
      return;
    }
    const baseModelId = resolveBaseModelId(entry);
    if (!baseModelId) {
      new Notice("Could not resolve a model id for this selection.");
      return;
    }

    if (!activeSession || activeSession.backendId !== targetBackendId) {
      // Legacy ModelSelector path: no effort plumbed through. Preserve any
      // existing persisted effort for this backend.
      const persistedEffort = manager.getDefaultSelection(targetBackendId)?.effort ?? null;
      runCrossBackendPick(
        manager,
        activeSession?.internalId,
        targetBackendId,
        targetDescriptor,
        baseModelId,
        persistedEffort
      );
      return;
    }
    // Same backend: flip the default eagerly, then route through the
    // running session.
    manager.setDefaultBackend(targetBackendId);
    if (activeChatUIState?.canSwitchModel() === false) {
      new Notice("This agent doesn't support runtime model switching.");
      return;
    }
    manager.applySelection({ baseModelId }).catch((err) => {
      handlePickerSwitchError(err, "model");
    });
  };
}

/**
 * Build the per-entry effort catalog used by the merged model+effort picker.
 * Keyed by `getModelKeyFromModel(entry)` so the picker can look up effort
 * options for any highlighted row, not just the active one.
 */
export function buildEffortOptionsByModelKey(
  manager: AgentSessionManager,
  entries: ModelSelectorEntry[]
): Record<string, EffortOption[]> {
  const out: Record<string, EffortOption[]> = {};
  for (const entry of entries) {
    const backendId = entry._backendId;
    const baseModelId = resolveBaseModelId(entry);
    if (!backendId || !baseModelId) continue;
    out[getModelKeyFromModel(entry)] = resolveEffortOptions(manager, backendId, baseModelId);
  }
  return out;
}

/**
 * Effort options for one (backend, model). The reported catalog only carries
 * effort for the *active* model (opencode surfaces it only for the current
 * model); fall back to the preloader's prefetched effort catalog for every
 * other model. Returns `EMPTY_EFFORT_OPTIONS` when the model has none.
 */
export function resolveEffortOptions(
  manager: AgentSessionManager,
  backendId: BackendId,
  baseModelId: string
): EffortOption[] {
  const catalog = manager.getCachedBackendState(backendId)?.model?.availableModels ?? null;
  const found = catalog?.find((m) => m.baseModelId === baseModelId);
  const live = found?.effortOptions ?? [];
  if (live.length > 0) return live;
  return manager.getEffortCatalog(backendId)?.[baseModelId] ?? EMPTY_EFFORT_OPTIONS;
}

/**
 * Build the atomic `(model, effort)` commit callback used by the merged
 * picker. Same-backend picks push both fields through `applySelection` in
 * one call. Cross-backend picks seed a fresh session on the target with
 * the drafted `(baseModelId, effort)` — the user's effort choice survives
 * the backend swap, and the saved default for either backend is left alone.
 */
export function buildCommitSelection(
  manager: AgentSessionManager,
  ctx: ModelActiveContext,
  entries: ModelSelectorEntry[],
  modelOnChange: (modelKey: string) => void
): (modelKey: string, effort: string | null) => void {
  const { activeSession, activeChatUIState } = ctx;
  return (modelKey, effort) => {
    const entry = entries.find((e) => getModelKeyFromModel(e) === modelKey);
    if (!entry) return;
    const baseModelId = resolveBaseModelId(entry);
    const targetBackendId = entry._backendId;
    if (!baseModelId || !targetBackendId) {
      modelOnChange(modelKey);
      return;
    }
    const targetDescriptor = backendRegistry[targetBackendId];
    if (!targetDescriptor) {
      logError("[AgentMode] commitSelection references unknown backend", targetBackendId);
      return;
    }
    if (!activeSession || activeSession.backendId !== targetBackendId) {
      runCrossBackendPick(
        manager,
        activeSession?.internalId,
        targetBackendId,
        targetDescriptor,
        baseModelId,
        effort
      );
      return;
    }
    if (activeChatUIState?.canSwitchModel() === false) {
      new Notice("This agent doesn't support runtime model switching.");
      return;
    }
    manager.applySelection({ baseModelId, effort }).catch((err) => {
      handlePickerSwitchError(err, "model");
    });
  };
}

/**
 * Outer orchestrator — builds the full model+effort `AgentModelPickerOverride`.
 */
export function buildAgentModelPicker(args: {
  manager: AgentSessionManager | null;
  descriptors: BackendDescriptor[];
  settings: CopilotSettings;
}): AgentModelPickerOverride | null {
  const { manager, descriptors, settings } = args;
  if (!manager) return null;
  const ctx = collectModelActiveContext(manager);
  const { entries, valueKey } = buildPickerEntries(manager, descriptors, ctx, settings);
  const onChange = buildModelOnChange(manager, ctx, entries);
  return {
    models: entries,
    value: valueKey,
    disabled: false,
    effort: buildEffortSibling(manager, ctx),
    effortOptionsByModelKey: buildEffortOptionsByModelKey(manager, entries),
    onChange,
    commitSelection: buildCommitSelection(manager, ctx, entries, onChange),
  };
}
