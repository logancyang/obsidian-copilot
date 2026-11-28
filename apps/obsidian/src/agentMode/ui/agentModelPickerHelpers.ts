import { resolveEffort, sortEffortOptions } from "@/lib/model-effort";
import { Notice } from "obsidian";
import { logError } from "@/logger";
import type { ModelCapability } from "@/constants";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { getModelKeyFromModel } from "@/lib/model-key";
import type {
  BackendId,
  EffortOption,
  EnabledModelCredentialState,
  EnabledModelEntry,
  ModelEntry,
  ModelState,
} from "@/agentMode/session/types";
import type {
  InstallKind,
  PickerAgent,
  PickerCatalog,
  ReportedModel,
} from "@copilot/protocol/pickerCatalog";
import type { AgentModelPickerOverride } from "./useAgentModelPicker";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";

export const EMPTY_EFFORT_OPTIONS = Object.freeze([]) as unknown as EffortOption[];

export const MISSING_KEY_LABEL = "Add API key";

export function handlePickerSwitchError(err: unknown, action: "model" | "effort" | "mode"): void {
  if (err instanceof MethodUnsupportedError) {
    new Notice(`This agent doesn't support switching ${action} switching.`);
    return;
  }
  logError(`[AgentMode] ${action} apply failed`, err);
  new Notice(`Failed to switch ${action}. Check the Copilot log for details.`);
}

const AGENT_PROVIDER = "agent";

type AgentLabel = Pick<PickerAgent, "id" | "displayName">;

export function appendBackendSection(
  entries: ModelSelectorEntry[],
  agent: PickerAgent,
  ctx: { useEnabledFallback?: boolean } = {}
): void {
  const enabledEntries = agent.enabledModels;
  if (!enabledEntries) return;
  const backendModels = agent.modelCatalog?.availableModels ?? null;
  if (!backendModels) {
    if (!ctx.useEnabledFallback) return;
    appendEnabledFallbackEntries(entries, agent, enabledEntries);
    return;
  }
  appendFromEnabledEntries(entries, agent, enabledEntries, backendModels);
}

function appendEnabledFallbackEntries(
  entries: ModelSelectorEntry[],
  agent: AgentLabel,
  enabledEntries: ReadonlyArray<EnabledModelEntry>
): void {
  for (const enabled of enabledEntries) {
    const entry = synthesizeAgentEntry(
      enabled.baseModelId,
      enabled.label || enabled.name,
      agent,
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
  agent: PickerAgent,
  enabledEntries: ReadonlyArray<EnabledModelEntry>,
  backendModels: ReadonlyArray<ReportedModel>
): void {
  const blocked = agent.blockedModels;
  const reportedById = new Map(backendModels.map((m) => [m.baseModelId, m]));
  for (const enabled of enabledEntries) {
    const reported = reportedById.get(enabled.baseModelId);
    const name = enabled.label || reported?.name || enabled.name;
    const subtitle = reported?.description ?? enabled.description;
    const capabilities = enabled.capabilities;
    const entry = synthesizeAgentEntry(
      enabled.baseModelId,
      name,
      agent,
      subtitle,
      enabled.isFree,
      capabilities
    );
    const reason = credentialDisabledReason(enabled.credentialState, !!reported);
    // An agent's own config can drop a provider Copilot added, which reads as a bug unless the picker names the cause.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/835
    if (enabled.credentialState === "ok" && blocked?.baseModelIds.includes(enabled.baseModelId)) {
      entry._disabledReason = blocked.reason;
      entry._disabledHint = blocked.hint;
    } else if (reason) {
      entry._disabledReason = reason;
    }
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

export function backendReadinessReason(kind: InstallKind): string | undefined {
  switch (kind) {
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
  agent: AgentLabel,
  subtitle?: string,
  isFree?: boolean,
  capabilities?: ModelCapability[]
): ModelSelectorEntry {
  return {
    name: baseModelId,
    provider: AGENT_PROVIDER,
    enabled: true,
    displayName: humanName || baseModelId,
    capabilities,
    _group: agent.displayName,
    _backendId: agent.id,
    _subtitle: subtitle,
    _isFree: isFree,
  };
}

function synthesizePreloadPlaceholder(
  agent: AgentLabel,
  status: "pending" | "error"
): ModelSelectorEntry {
  const pending = status === "pending";
  return {
    ...synthesizeAgentEntry(
      `__preload_${status}__`,
      pending ? "Loading models…" : "Failed to load",
      agent
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
  activeChatTiedToAgent: boolean;
  activeModelState: ModelState | null;
  activeCurrentEntry: ModelEntry | undefined;
}

export function collectModelActiveContext(manager: AgentSessionManager): ModelActiveContext {
  const activeSession = manager.getActiveSession();
  const activeChatUIState = manager.getActiveChatUIState();
  const activeBackendId = activeSession?.backendId ?? null;
  const activeChatTiedToAgent = activeSession
    ? manager.isTiedToAgent(activeSession.internalId)
    : false;
  const activeState = activeSession?.getState() ?? null;
  const activeModelState = activeState?.model ?? null;
  const activeCurrentEntry = activeModelState?.availableModels.find(
    (e) => e.baseModelId === activeModelState.current.baseModelId
  );
  return {
    activeSession,
    activeChatUIState,
    activeBackendId,
    activeChatTiedToAgent,
    activeModelState,
    activeCurrentEntry,
  };
}

export function buildPickerEntries(
  catalog: PickerCatalog,
  ctx: ModelActiveContext
): { entries: ModelSelectorEntry[]; valueKey: string } {
  const entries: ModelSelectorEntry[] = [];
  for (const agent of catalog.agents) {
    const isActiveBackend = agent.id === ctx.activeBackendId;
    if (!isActiveBackend && ctx.activeChatTiedToAgent) continue;
    const hasNoCatalog = agent.modelCatalog === null;
    const preloadStatus = agent.preload;
    for (const locked of agent.lockedPreview) {
      entries.push({
        name: locked.name,
        provider: locked.provider,
        displayName: locked.displayName,
        enabled: true,
        _disabledReason: locked.disabledReason,
        _needsLicense: true,
        _subtitle: locked.subtitle,
        _group: agent.displayName,
        _backendId: agent.id,
      });
    }
    // An agent the user never installed must not promote its models, least of all to a licensed user.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/765
    if (!isActiveBackend && agent.installKind === "absent") continue;
    const sectionStart = entries.length;
    appendBackendSection(entries, agent, {
      useEnabledFallback: hasNoCatalog && (preloadStatus === "ready" || preloadStatus === "error"),
    });
    if (hasNoCatalog && entries.length === sectionStart) {
      if (preloadStatus === "pending") {
        entries.push(synthesizePreloadPlaceholder(agent, "pending"));
      } else if (preloadStatus === "ready" || preloadStatus === "error") {
        entries.push(synthesizePreloadPlaceholder(agent, "error"));
      }
    }
    if (!isActiveBackend) {
      const readiness = backendReadinessReason(agent.installKind);
      if (readiness) {
        for (let i = sectionStart; i < entries.length; i++) {
          entries[i]._disabledReason = readiness;
        }
      }
    }
    if (agent.selfHostWarning) {
      for (let i = sectionStart; i < entries.length; i++) {
        entries[i]._needsSelfHostWarning = true;
      }
    }
  }

  const activeAgent = catalog.agents.find((agent) => agent.id === ctx.activeBackendId);
  let valueKey = "";
  if (activeAgent && ctx.activeSession?.getStatus() === "starting") {
    // While starting, the agent still reports its own model, not the chat's, so show "Loading models…".
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/630
    const loading = synthesizePreloadPlaceholder(activeAgent, "pending");
    valueKey = getModelKeyFromModel(loading);
    if (!entries.some((e) => getModelKeyFromModel(e) === valueKey)) entries.unshift(loading);
  } else if (ctx.activeBackendId && activeAgent && ctx.activeModelState) {
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
      !activeAgent.routesCopilotModels
    ) {
      const synth = synthesizeAgentEntry(
        baseId,
        ctx.activeCurrentEntry.name,
        activeAgent,
        ctx.activeCurrentEntry.description,
        undefined,
        undefined
      );
      if (activeAgent.selfHostWarning) {
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
  targetAgent: AgentLabel,
  baseModelId: string,
  effort: string | null
): void {
  void (async () => {
    try {
      const seedSelection = { baseModelId, effort };
      if (oldSessionId) {
        await manager.replaceSessionInPlace(oldSessionId, targetAgent.id, { seedSelection });
      } else {
        await manager.createSession(targetAgent.id, undefined, seedSelection);
      }
      manager.setDefaultBackend(targetAgent.id);
    } catch (err) {
      logError("[AgentMode] cross-backend pick failed", err);
      new Notice(`Failed to start ${targetAgent.displayName}. Check the Copilot log for details.`);
    }
  })();
}

export function buildModelOnChange(
  manager: AgentSessionManager,
  catalog: PickerCatalog,
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
    const targetAgent = findAgent(catalog, targetBackendId);
    if (!targetAgent) {
      logError("[AgentMode] picker entry references unknown backend", targetBackendId);
      return;
    }
    const baseModelId = resolveBaseModelId(entry);
    if (!baseModelId) {
      new Notice("Couldn't find that model. Pick another one.");
      return;
    }

    if (!activeSession || activeSession.backendId !== targetBackendId) {
      const persistedEffort = targetAgent.defaultSelection?.effort ?? null;
      runCrossBackendPick(
        manager,
        activeSession?.internalId,
        targetAgent,
        baseModelId,
        persistedEffort
      );
      return;
    }
    manager.setDefaultBackend(targetBackendId);
    if (activeChatUIState?.canSwitchModel() === false) {
      new Notice("This agent doesn't support switching models mid-chat.");
      return;
    }
    manager.applySelection({ baseModelId }).catch((err) => {
      handlePickerSwitchError(err, "model");
    });
  };
}

export function buildEffortOptionsByModelKey(
  catalog: PickerCatalog,
  entries: ModelSelectorEntry[]
): Record<string, EffortOption[]> {
  const out: Record<string, EffortOption[]> = {};
  for (const entry of entries) {
    const backendId = entry._backendId;
    const baseModelId = resolveBaseModelId(entry);
    if (!backendId || !baseModelId) continue;
    out[getModelKeyFromModel(entry)] = resolveEffortOptions(
      findAgent(catalog, backendId),
      baseModelId
    );
  }
  return out;
}

export interface EffortSource {
  modelCatalog: { availableModels: readonly ReportedModel[] | null } | null;
  effortCatalog: Record<string, EffortOption[]> | null;
}

export function resolveEffortOptions(
  source: EffortSource | undefined,
  baseModelId: string
): EffortOption[] {
  const models = source?.modelCatalog?.availableModels ?? null;
  const found = models?.find((m) => m.baseModelId === baseModelId);
  const reported = found?.effortOptions ?? [];
  if (reported.length > 0) return sortEffortOptions(reported);
  return sortEffortOptions(source?.effortCatalog?.[baseModelId] ?? EMPTY_EFFORT_OPTIONS);
}

function findAgent(catalog: PickerCatalog, backendId: BackendId): PickerAgent | undefined {
  return catalog.agents.find((agent) => agent.id === backendId);
}

function buildCommitSelection(
  manager: AgentSessionManager,
  catalog: PickerCatalog,
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
    const targetAgent = findAgent(catalog, targetBackendId);
    if (!targetAgent) {
      logError("[AgentMode] commitSelection references unknown backend", targetBackendId);
      return;
    }
    if (!activeSession || activeSession.backendId !== targetBackendId) {
      runCrossBackendPick(manager, activeSession?.internalId, targetAgent, baseModelId, effort);
      return;
    }
    if (activeChatUIState?.canSwitchModel() === false) {
      new Notice("This agent doesn't support switching models mid-chat.");
      return;
    }
    manager.applySelection({ baseModelId, effort }).catch((err) => {
      handlePickerSwitchError(err, "model");
    });
  };
}

export function buildAgentModelPicker(args: {
  manager: AgentSessionManager | null;
  catalog: PickerCatalog;
}): AgentModelPickerOverride | null {
  const { manager, catalog } = args;
  if (!manager) return null;
  const ctx = collectModelActiveContext(manager);
  const { entries, valueKey } = buildPickerEntries(catalog, ctx);
  const onChange = buildModelOnChange(manager, catalog, ctx, entries);
  return {
    models: entries,
    value: valueKey,
    disabled: false,
    effort: buildEffortSibling(manager, ctx),
    effortOptionsByModelKey: buildEffortOptionsByModelKey(catalog, entries),
    onChange,
    commitSelection: buildCommitSelection(manager, catalog, ctx, entries, onChange),
  };
}

export function buildAgentModelChoices(catalog: PickerCatalog): AgentModelChoices {
  const noChat: ModelActiveContext = {
    activeSession: null,
    activeChatUIState: null,
    activeBackendId: null,
    activeChatTiedToAgent: false,
    activeModelState: null,
    activeCurrentEntry: undefined,
  };
  const { entries } = buildPickerEntries(catalog, noChat);
  const runnable = entries.filter((entry) => !entry._disabledReason && !entry._needsLicense);
  const backendId = catalog.defaultAgent;
  const saved = catalog.agents.find((agent) => agent.id === backendId)?.defaultSelection ?? null;
  const savedEntry =
    saved && runnable.find((e) => e._backendId === backendId && e.name === saved.baseModelId);
  const initial =
    savedEntry || runnable.find((entry) => entry._backendId === backendId) || runnable[0];
  const effortOptionsByModelKey = buildEffortOptionsByModelKey(catalog, entries);
  // A model saved without an effort runs at the level a chat resolves it to, so the field shows that level as the composer does.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/939
  const initialEffort =
    initial &&
    resolveEffort(
      savedEntry ? saved.effort : null,
      effortOptionsByModelKey[getModelKeyFromModel(initial)]
    );
  return {
    models: entries,
    effortOptionsByModelKey,
    initial: initial ? { baseModelId: initial.name, effort: initialEffort ?? null } : null,
  };
}
