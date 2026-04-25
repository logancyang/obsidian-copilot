import { useEffect, useMemo, useState } from "react";
import { Notice } from "obsidian";
import type { CustomModel } from "@/aiParams";
import { logError } from "@/logger";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { useActiveBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/acp/types";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
}

/**
 * Build the `modelPickerOverride` shape Agent Mode hands to `ChatInput` so the
 * shared `ModelSelector` lights up with the agent-aware list.
 *
 * The list combines:
 *   1. Copilot-configured models (`partition.compatible`) — always shown,
 *      enabled if the agent reported them, otherwise disabled with a
 *      "Restart agent to load" hint. Incompatible ones are omitted.
 *   2. Agent-reported models the user *hasn't* curated — shown as
 *      synthesized entries so OpenCode's built-in defaults stay visible.
 *      "Curated" means the user has at least one Copilot model with that
 *      provider; once a provider is curated, the agent's full catalog for
 *      the same provider is hidden (prevents e.g. OpenRouter's 200-model
 *      catalog from drowning out a single configured OpenRouter model).
 *
 * Returns `null` when the agent doesn't report a model state (older
 * backends), so callers can omit the override and fall back to the default
 * `ChatInput` picker behavior.
 */
export function useAgentModelPicker(
  backend: AgentChatBackend | null,
  manager: AgentSessionManager | null
): AgentModelPickerOverride | null {
  const descriptor = useActiveBackendDescriptor();
  const settings = useSettingsValue();

  // Subscribe to backend updates so model-change notifications cause re-render.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!backend) return;
    return backend.subscribe(() => forceRender((n) => n + 1));
  }, [backend]);

  const modelState = backend?.getModelState() ?? null;
  const isModelSwitchSupported = backend?.isModelSwitchSupported() ?? null;

  const override = useMemo<AgentModelPickerOverride | null>(() => {
    if (!backend || !modelState) return null;

    const filterFn = descriptor.filterCopilotModels;
    const translateFn = descriptor.copilotModelKeyToAgentModelId;
    const reverseProviderFn = descriptor.agentModelIdToCopilotProvider;
    const partition = filterFn
      ? filterFn(settings.activeModels ?? [])
      : { compatible: settings.activeModels ?? [], incompatible: [] };

    const agentAvailableIds = new Set(modelState.availableModels.map((m) => m.modelId));
    // Track which Copilot providers the user has explicitly curated and the
    // agent ids those Copilot entries translate to (used to suppress duplicate
    // synthesized entries).
    const curatedProviders = new Set<string>();
    const curatedAgentIds = new Set<string>();
    const copilotByAgentId = new Map<string, CustomModel>();
    for (const m of partition.compatible) {
      curatedProviders.add(m.provider);
      const agentId = translateFn?.(m);
      if (agentId) {
        curatedAgentIds.add(agentId);
        copilotByAgentId.set(agentId, m);
      }
    }

    const entries: ModelSelectorEntry[] = [];

    for (const m of partition.compatible) {
      const agentId = translateFn?.(m);
      const isAvailable = agentId !== undefined && agentAvailableIds.has(agentId);
      entries.push(
        isAvailable ? { ...m, enabled: true } : { ...m, _disabledReason: "Restart agent to load" }
      );
    }

    // Surface agent-reported models for providers the user hasn't curated in
    // Copilot. Skips models whose provider has at least one Copilot entry —
    // that's our signal the user is hand-picking models for that provider.
    for (const m of modelState.availableModels) {
      if (curatedAgentIds.has(m.modelId)) continue;
      const copilotProvider = reverseProviderFn?.(m.modelId);
      if (copilotProvider && curatedProviders.has(copilotProvider)) continue;
      entries.push(synthesizeAgentEntry(m.modelId, m.name));
    }

    const valueKey = computeValueKey(modelState.currentModelId, copilotByAgentId);

    // Edge case: the agent's `currentModelId` lands inside a curated provider
    // but isn't one of the user's configured entries (stale
    // `selectedModelKey`, or the agent fell back to a catalog default we
    // filtered out). Surface it as a synthesized entry so the dropdown value
    // isn't dangling.
    if (modelState.currentModelId && !entries.some((e) => getModelKeyFromModel(e) === valueKey)) {
      const currentInfo = modelState.availableModels.find(
        (m) => m.modelId === modelState.currentModelId
      );
      if (currentInfo) {
        entries.unshift(synthesizeAgentEntry(currentInfo.modelId, currentInfo.name));
      }
    }

    return {
      models: entries,
      value: valueKey,
      disabled: isModelSwitchSupported === false,
      onChange: (modelKey: string) => {
        // Resolve the chosen entry to an agent-native id. If it's a
        // Copilot-side key, ask the descriptor to translate; otherwise it's
        // already a synthesized "agent|<id>" key — strip the prefix.
        const agentId = resolveAgentIdFromKey(modelKey, settings.activeModels ?? [], translateFn);
        if (!agentId) {
          new Notice("Could not resolve a model id for this selection.");
          return;
        }
        if (!manager) return;
        manager.setActiveSessionModel(agentId).catch((err) => {
          if (err instanceof MethodUnsupportedError) {
            new Notice("This agent doesn't support runtime model switching.");
            return;
          }
          logError("[AgentMode] setActiveSessionModel failed", err);
          new Notice("Failed to switch model. See console for details.");
        });
      },
    };
  }, [backend, descriptor, settings.activeModels, modelState, isModelSwitchSupported, manager]);

  return override;
}

/** A pseudo-provider value used for agent-only synthesized entries. */
const AGENT_PROVIDER = "agent";

function synthesizeAgentEntry(modelId: string, humanName: string): ModelSelectorEntry {
  return {
    name: modelId,
    provider: AGENT_PROVIDER,
    enabled: true,
    isBuiltIn: false,
    displayName: humanName || modelId,
  };
}

function computeValueKey(
  currentModelId: string,
  copilotByAgentId: Map<string, CustomModel>
): string {
  const copilot = copilotByAgentId.get(currentModelId);
  if (copilot) return getModelKeyFromModel(copilot);
  return `${currentModelId}|${AGENT_PROVIDER}`;
}

function resolveAgentIdFromKey(
  modelKey: string,
  activeModels: CustomModel[],
  translateFn: ((model: CustomModel) => string | undefined) | undefined
): string | undefined {
  const sep = modelKey.lastIndexOf("|");
  if (sep < 0) return undefined;
  const provider = modelKey.slice(sep + 1);
  const name = modelKey.slice(0, sep);
  if (provider === AGENT_PROVIDER) return name;
  const match = activeModels.find((m) => m.name === name && m.provider === provider);
  if (!match) return undefined;
  return translateFn ? translateFn(match) : undefined;
}
