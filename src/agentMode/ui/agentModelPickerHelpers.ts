import { Notice } from "obsidian";
import { logError } from "@/logger";
import type { ModelCapability } from "@/constants";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { lockedCopilotEntries } from "@/lib/lockedCopilotEntries";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { backendNeedsSelfHostWarning, backendRegistry } from "@/agentMode/backends/registry";
import { getModelKeyFromModel } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import type {
  BackendDescriptor,
  BackendId,
  EffortOption,
  EnabledModelCredentialState,
  EnabledModelEntry,
  InstallState,
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
 * Preserves usable and stranded choices for one backend so credential or catalog drift never hides recovery paths.
 * @param entries - The picker entries being assembled across backends.
 * @param descriptor - The backend whose model choices and selection policy should be represented.
 * @param ctx - The catalog, settings, and active-selection context for this backend.
 */
export function appendBackendSection(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  ctx: {
    /** Translator-produced entries from probe-owned model discovery. */
    backendModels: ReadonlyArray<ModelEntry> | null;
    /** baseModelId of the active session — never filtered out. */
    keepBaseModelId: string | null;
    /** Current settings — read by `getEnabledModelEntries`. */
    settings: CopilotSettings;
    /** Preload settled without a catalog, so persisted enabled models are the only recovery path. */
    useEnabledFallback?: boolean;
  }
): void {
  const enabledEntries = descriptor.getEnabledModelEntries?.(ctx.settings) ?? null;
  if (!enabledEntries) return;
  if (!ctx.backendModels) {
    if (!ctx.useEnabledFallback) return;
    appendEnabledFallbackEntries(entries, descriptor, enabledEntries);
    return;
  }
  appendFromEnabledEntries(
    entries,
    descriptor,
    enabledEntries,
    ctx.backendModels,
    ctx.keepBaseModelId
  );
}

function appendEnabledFallbackEntries(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  enabledEntries: ReadonlyArray<EnabledModelEntry>
): void {
  for (const enabled of enabledEntries) {
    const entry = synthesizeAgentEntry(
      enabled.baseModelId,
      enabled.name || enabled.baseModelId,
      descriptor,
      enabled.description,
      enabled.isFree,
      enabled.capabilities
    );
    if (enabled.credentialState === "missing_key") entry._disabledReason = MISSING_KEY_LABEL;
    entries.push(entry);
  }
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
    // Capabilities come from the model's persisted `ConfiguredModel.info`
    // modality snapshot. `undefined` (no snapshot) means "unknown" — no icon,
    // and the image-send guard leaves the model unblocked.
    const capabilities = enabled.capabilities;
    const entry = synthesizeAgentEntry(
      enabled.baseModelId,
      name,
      descriptor,
      subtitle,
      enabled.isFree,
      capabilities
    );
    const reason = credentialDisabledReason(enabled.credentialState, !!reported);
    if (reason) entry._disabledReason = reason;
    // Per-model cloud-egress flag: a self-hostable backend (opencode) can host
    // cloud BYOK/Plus providers, so the warning is decided per model here, not
    // only by the backend's own `selfHostable` in `buildPickerEntries`.
    if (enabled.needsSelfHostWarning) entry._needsSelfHostWarning = true;
    entries.push(entry);
    emitted.add(enabled.baseModelId);
  }

  if (keepBaseModelId && !emitted.has(keepBaseModelId)) {
    const reported = reportedById.get(keepBaseModelId);
    if (reported) {
      // This reported-but-not-enabled row carries no per-model cloud-egress flag.
      // For a cloud agent (claude/codex) the section-level pass in
      // `buildPickerEntries` still marks it. For opencode it can only be a
      // native/Zen model (opencode reports solely providers injected from the
      // enabled set, so a cloud BYOK model can't be reported-but-unenabled) —
      // Zen already warns via `_isFree`, so no provider-level flag is needed here.
      entries.push(
        synthesizeAgentEntry(
          reported.baseModelId,
          reported.name,
          descriptor,
          reported.description,
          undefined,
          undefined
        )
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

/**
 * Map a backend's readiness to a `_disabledReason` for every row it
 * contributes, or `undefined` when its rows stay selectable. Picking a model on
 * a backend that isn't set up can only end in a failed spawn, so the picker says
 * so up front instead of letting the user find out by losing their pane.
 *
 * `checking` stays selectable: it is a transient probe that resolves on its own,
 * and labelling a backend "not set up" for the moment it takes to read a version
 * would be wrong more often than it is right. `error` reads `Setup error` rather
 * than the preload placeholder's `Unavailable` — the distinction matters because
 * this one is fixed in the backend's Configure dialog, not by waiting.
 */
export function backendReadinessReason(state: InstallState): string | undefined {
  switch (state.kind) {
    case "absent":
      return "Not set up";
    case "incompatible":
      return "Update required";
    case "error":
      return "Setup error";
    case "checking":
    case "ready":
      return undefined;
  }
}

export function synthesizeAgentEntry(
  baseModelId: string,
  humanName: string,
  descriptor: BackendDescriptor,
  subtitle?: string,
  isFree?: boolean,
  /**
   * Capabilities from the model's persisted `ConfiguredModel.info` snapshot, or
   * `undefined` when unknown (no snapshot). Left off the entry entirely when
   * undefined so the image-send guard treats the model as "unknown" — never
   * blocked.
   */
  capabilities?: ModelCapability[]
): ModelSelectorEntry {
  return {
    name: baseModelId,
    provider: AGENT_PROVIDER,
    enabled: true,
    isBuiltIn: false,
    displayName: humanName || baseModelId,
    capabilities,
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
  const activeState = activeSession?.getState() ?? null;
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
 * Builds a cross-backend picker that keeps the active choice visible through preload gaps and catalog changes.
 * @param manager - The session manager that owns session selection and shared model discovery.
 * @param descriptors - The registered backends that may contribute picker choices.
 * @param ctx - The active session and model context that must remain stable in the picker.
 * @param settings - The persisted configuration used to determine enabled choices.
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
    const catalog = manager.getCachedModelCatalog(descriptor.id);
    const keepBaseModelId = isActiveBackend
      ? (ctx.activeModelState?.current.baseModelId ?? null)
      : (manager.getDefaultSelection(descriptor.id)?.baseModelId ?? null);
    const backendModels = catalog?.availableModels ?? null;
    const hasNoCatalog = catalog === null;
    const preloadStatus = manager.getPreloadStatus(descriptor.id);
    const sectionStart = entries.length;
    appendBackendSection(entries, descriptor, {
      backendModels,
      keepBaseModelId,
      settings,
      useEnabledFallback: hasNoCatalog && (preloadStatus === "ready" || preloadStatus === "error"),
    });
    // No catalog discovered yet (distinct from a settled probe reporting no
    // model catalog). Show a per-backend loading / failure row so
    // the user can see every installed backend immediately — important
    // because the chat now unblocks on just the *active* backend's
    // preload, not the global preload.
    if (hasNoCatalog && entries.length === sectionStart) {
      if (preloadStatus === "pending") {
        entries.push(synthesizePreloadPlaceholder(descriptor, "pending"));
      } else if (preloadStatus === "ready" || preloadStatus === "error") {
        entries.push(synthesizePreloadPlaceholder(descriptor, "error"));
      }
    }
    // Mark every row of a backend that can't run, so a doomed cross-backend
    // pick is never offered as if it were selectable. This overwrites a
    // per-model credential reason on purpose: an agent that isn't set up is the
    // root cause, and "Add API key" would send the user to the wrong fix.
    // The *active* backend is exempt — its rows are the running session's own
    // selection, and disabling them would strand the current model (the merged
    // picker seeds its draft from selectable rows only, so it would silently
    // draft a different backend's model instead).
    // The caller subscribes to every descriptor's install-state store as well
    // as settings, so async compatibility probes relabel these rows even when
    // no persisted setting changed.
    if (!isActiveBackend) {
      const readiness = backendReadinessReason(descriptor.getInstallState(settings));
      if (readiness) {
        for (let i = sectionStart; i < entries.length; i++) {
          entries[i]._disabledReason = readiness;
        }
      }
    }
    // Flag this backend's rows when Self-Host Mode marks it as cloud. Registry
    // order already places self-hostable backends (opencode) first, so warned
    // sections naturally sort last — no reordering needed here.
    if (backendNeedsSelfHostWarning(descriptor, settings)) {
      for (let i = sectionStart; i < entries.length; i++) {
        entries[i]._needsSelfHostWarning = true;
      }
    }
    // Advertise the Copilot lineup to a user who has no license, at the top of
    // the section for each agent that could run it. Spliced in after the passes
    // above so neither relabels these rows: an unset-up agent's readiness reason
    // would replace "Copilot license required" with the wrong fix, and the
    // emptiness check for the loading/error placeholder must not count them.
    if (descriptor.routesCopilotModels && !settings.isPaidUser) {
      entries.splice(
        sectionStart,
        0,
        ...lockedCopilotEntries({ group: descriptor.displayName, backendId: descriptor.id })
      );
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
        ctx.activeCurrentEntry.description,
        undefined,
        undefined
      );
      // The stranded active row is created after the per-section marking above,
      // so flag it here when its backend is a cloud agent under Self-Host Mode.
      if (backendNeedsSelfHostWarning(ctx.activeDescriptor, settings)) {
        synth._needsSelfHostWarning = true;
      }
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
      const seedSelection = { baseModelId, effort };
      if (oldSessionId) {
        await manager.replaceSessionInPlace(oldSessionId, targetBackendId, {
          preserveChatInput: true,
          seedSelection,
        });
      } else {
        // projectId left default (active scope); the transient pick only seeds the model.
        await manager.createSession(targetBackendId, undefined, seedSelection);
      }
      manager.setDefaultBackend(targetBackendId);
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
 * legacy single-arg signature), replacing the runtime session while retaining
 * its logical chat input. Same-backend picks route through the running session via
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
 * Effort options for one (backend, model). Prefer options carried by shared
 * model discovery, then fall back to the preloader's per-model effort
 * prefetch. Returns `EMPTY_EFFORT_OPTIONS` when the model has none.
 */
export function resolveEffortOptions(
  manager: AgentSessionManager,
  backendId: BackendId,
  baseModelId: string
): EffortOption[] {
  const models = manager.getCachedModelCatalog(backendId)?.availableModels ?? null;
  const found = models?.find((m) => m.baseModelId === baseModelId);
  const reported = found?.effortOptions ?? [];
  if (reported.length > 0) return reported;
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
