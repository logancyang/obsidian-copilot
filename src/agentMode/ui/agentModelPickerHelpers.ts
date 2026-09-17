import { Notice } from "obsidian";
import { logError } from "@/logger";
import type { ModelCapability } from "@/constants";
import type { AgentEntry } from "@/agents/types";
import type { AgentPickerRow } from "@/components/ui/ModelEffortPicker";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { lockedCopilotEntries, shouldPreviewCopilotModels } from "@/lib/lockedCopilotEntries";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { resolveEffortOptions } from "@/agentMode/session/effortOptions";
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
import type { AgentTalkingTo } from "./useAgentTalkingTo";
import type { AgentModelPickerOverride } from "./useAgentModelPicker";

export const MISSING_KEY_LABEL = "Add API key";

export function handlePickerSwitchError(err: unknown, action: "model" | "effort" | "mode"): void {
  if (err instanceof MethodUnsupportedError) {
    new Notice(`This agent doesn't support runtime ${action} switching.`);
    return;
  }
  logError(`[AgentMode] ${action} apply failed`, err);
  new Notice(`Failed to switch ${action}. See console for details.`);
}

const AGENT_PROVIDER = "agent";

export function appendBackendSection(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  ctx: {
    backendModels: ReadonlyArray<ModelEntry> | null;
    settings: CopilotSettings;
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
  appendFromEnabledEntries(entries, descriptor, enabledEntries, ctx.backendModels);
}

function appendEnabledFallbackEntries(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  enabledEntries: ReadonlyArray<EnabledModelEntry>
): void {
  for (const enabled of enabledEntries) {
    const entry = synthesizeAgentEntry(
      enabled.baseModelId,
      enabled.label || enabled.name,
      descriptor,
      enabled.description,
      enabled.isFree,
      enabled.capabilities
    );
    if (enabled.credentialState === "missing_key") entry._disabledReason = MISSING_KEY_LABEL;
    entries.push(entry);
  }
}

function appendFromEnabledEntries(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  enabledEntries: ReadonlyArray<EnabledModelEntry>,
  backendModels: ReadonlyArray<ModelEntry>
): void {
  const reportedById = new Map(backendModels.map((m) => [m.baseModelId, m]));
  for (const enabled of enabledEntries) {
    const reported = reportedById.get(enabled.baseModelId);
    const name = enabled.label || reported?.name || enabled.name;
    const subtitle = reported?.description ?? enabled.description;
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
    if (enabled.needsSelfHostWarning) entry._needsSelfHostWarning = true;
    entries.push(entry);
  }
}

function credentialDisabledReason(
  state: EnabledModelCredentialState,
  reported: boolean
): string | undefined {
  if (state === "missing_key") return MISSING_KEY_LABEL;
  if (!reported) return "Not offered by agent";
  return undefined;
}

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

function synthesizePreloadPlaceholder(
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

function resolveBaseModelId(entry: ModelSelectorEntry): string | undefined {
  return entry.provider === AGENT_PROVIDER ? entry.name : undefined;
}

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
    const backendModels = catalog?.availableModels ?? null;
    const hasNoCatalog = catalog === null;
    const preloadStatus = manager.getPreloadStatus(descriptor.id);
    const sectionStart = entries.length;
    appendBackendSection(entries, descriptor, {
      backendModels,
      settings,
      useEnabledFallback: hasNoCatalog && (preloadStatus === "ready" || preloadStatus === "error"),
    });
    if (hasNoCatalog && entries.length === sectionStart) {
      if (preloadStatus === "pending") {
        entries.push(synthesizePreloadPlaceholder(descriptor, "pending"));
      } else if (preloadStatus === "ready" || preloadStatus === "error") {
        entries.push(synthesizePreloadPlaceholder(descriptor, "error"));
      }
    }
    if (!isActiveBackend) {
      const readiness = backendReadinessReason(descriptor.getInstallState(settings));
      if (readiness) {
        for (let i = sectionStart; i < entries.length; i++) {
          entries[i]._disabledReason = readiness;
        }
      }
    }
    if (backendNeedsSelfHostWarning(descriptor, settings)) {
      for (let i = sectionStart; i < entries.length; i++) {
        entries[i]._needsSelfHostWarning = true;
      }
    }
    if (descriptor.routesCopilotModels && shouldPreviewCopilotModels(settings.providers)) {
      entries.splice(
        sectionStart,
        0,
        ...lockedCopilotEntries(settings.copilotPlusCatalog, {
          group: descriptor.displayName,
          backendId: descriptor.id,
        })
      );
    }
  }

  let valueKey = "";
  if (ctx.activeDescriptor && ctx.activeSession?.getStatus() === "starting") {
    // While starting, the agent still reports its own model, not the chat's, so show "Loading models…".
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/630
    const loading = synthesizePreloadPlaceholder(ctx.activeDescriptor, "pending");
    valueKey = getModelKeyFromModel(loading);
    if (!entries.some((e) => getModelKeyFromModel(e) === valueKey)) entries.unshift(loading);
  } else if (ctx.activeBackendId && ctx.activeDescriptor && ctx.activeModelState) {
    const baseId = ctx.activeModelState.current.baseModelId;
    const match = entries.find(
      (e) => e._backendId === ctx.activeBackendId && resolveBaseModelId(e) === baseId
    );
    if (match) {
      valueKey = getModelKeyFromModel(match);
    } else if (
      ctx.activeCurrentEntry &&
      // A backend that may only run enabled models must never show any other model.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
      !ctx.activeDescriptor.routesCopilotModels
    ) {
      const synth = synthesizeAgentEntry(
        baseId,
        ctx.activeCurrentEntry.name,
        ctx.activeDescriptor,
        ctx.activeCurrentEntry.description,
        undefined,
        undefined
      );
      if (backendNeedsSelfHostWarning(ctx.activeDescriptor, settings)) {
        synth._needsSelfHostWarning = true;
      }
      entries.unshift(synth);
      valueKey = getModelKeyFromModel(synth);
    }
  }

  return { entries, valueKey };
}

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
        await manager.createSession(targetBackendId, undefined, seedSelection);
      }
      manager.setDefaultBackend(targetBackendId);
    } catch (err) {
      logError("[AgentMode] cross-backend pick failed", err);
      new Notice(`Failed to start ${targetDescriptor.displayName}. See console for details.`);
    }
  })();
}

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

export function buildAgentPickerRows(
  entries: ModelSelectorEntry[],
  agentEntries: readonly AgentEntry[],
  activeBackendId: BackendId | null
): AgentPickerRow[] {
  return agentEntries.map((entry) => {
    const pins = entry.kind === "custom" ? entry.agent : null;
    const backendId = pins?.backendId ?? activeBackendId;
    const match =
      pins?.modelId && backendId
        ? entries.find(
            (candidate) =>
              candidate._backendId === backendId &&
              !candidate._disabledReason &&
              resolveBaseModelId(candidate) === pins.modelId
          )
        : undefined;
    return {
      slug: entry.slug,
      name: entry.name,
      icon: entry.icon,
      description: entry.description,
      modelKey: match ? getModelKeyFromModel(match) : null,
      effort: pins?.effort ?? null,
    };
  });
}

export function buildAgentModelPicker(args: {
  manager: AgentSessionManager | null;
  descriptors: BackendDescriptor[];
  settings: CopilotSettings;
  talkingTo: AgentTalkingTo;
}): AgentModelPickerOverride | null {
  const { manager, descriptors, settings, talkingTo } = args;
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
    agents: {
      rows: buildAgentPickerRows(entries, talkingTo.entries, ctx.activeBackendId),
      selectedSlug: talkingTo.selectedSlug,
      onSelect: talkingTo.select,
      onOpen: talkingTo.refresh,
    },
  };
}
