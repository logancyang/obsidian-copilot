import { resolveEffort } from "@/lib/model-effort";
import { SettingItem } from "@/components/ui/setting-item";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React, { useSyncExternalStore } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, EnabledModelEntry } from "@/agentMode/session/types";
import { AgentDefaultEffortSetting } from "@/agentMode/ui/AgentDefaultEffortSetting";
import {
  EMPTY_EFFORT_OPTIONS,
  MISSING_KEY_LABEL,
  resolveEffortOptions,
} from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

interface Props {
  descriptor: BackendDescriptor;
  manager: AgentSessionManager;
}

const AGENT_DEFAULT_VALUE = "__agent_default__";
const AGENT_DEFAULT_LABEL = "Agent default";
const EFFORT_NOT_SUPPORTED_LABEL = "Not supported";

export const AgentDefaultModelSetting: React.FC<Props> = ({ descriptor, manager }) => {
  const subscribe = useManagerSubscribe(manager);
  useSyncExternalStore(
    subscribe,
    () => manager.getModelCacheSignature(descriptor.id),
    () => manager.getModelCacheSignature(descriptor.id)
  );

  const settings = useSettingsValue();
  const enabled = descriptor.getEnabledModelEntries?.(settings) ?? null;

  const current = manager.getDefaultSelection(descriptor.id);
  const hasExplicitDefault = current !== null;

  if ((!enabled || enabled.length === 0) && !hasExplicitDefault) return null;

  const selectedBaseId = current?.baseModelId ?? AGENT_DEFAULT_VALUE;
  const rawEffortOptions = hasExplicitDefault
    ? resolveEffortOptions(manager, descriptor.id, selectedBaseId)
    : EMPTY_EFFORT_OPTIONS;
  const effortOptions = rawEffortOptions;
  const onModelChange = (baseModelId: string): void => {
    if (baseModelId === AGENT_DEFAULT_VALUE) {
      manager
        .persistDefaultSelection(descriptor.id, null)
        .catch((e) => logError(`[AgentMode] clear default model for ${descriptor.id} failed`, e));
      return;
    }
    const effort = resolveEffort(
      current?.effort,
      resolveEffortOptions(manager, descriptor.id, baseModelId)
    );
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId, effort })
      .catch((e) => logError(`[AgentMode] persist default model for ${descriptor.id} failed`, e));
  };

  const onEffortChange = (effort: string | null): void => {
    if (!hasExplicitDefault) return;
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId: selectedBaseId, effort })
      .catch((e) => logError(`[AgentMode] persist default effort for ${descriptor.id} failed`, e));
  };

  const enabledOptions = (enabled ?? []).map((e) => ({
    label: modelOptionLabel(e),
    value: e.baseModelId,
  }));
  const defaultMissingFromEnabled =
    hasExplicitDefault && !enabledOptions.some((o) => o.value === selectedBaseId);
  const modelOptions = defaultMissingFromEnabled
    ? [
        { label: AGENT_DEFAULT_LABEL, value: AGENT_DEFAULT_VALUE },
        { label: `${current?.baseModelId} (disabled)`, value: selectedBaseId },
        ...enabledOptions,
      ]
    : [{ label: AGENT_DEFAULT_LABEL, value: AGENT_DEFAULT_VALUE }, ...enabledOptions];

  return (
    <>
      <SettingItem
        type="select"
        title="Default model"
        description="Used for new chats and multi-agent answers on this agent. Open chats switch on their next turn."
        value={selectedBaseId}
        onChange={onModelChange}
        options={modelOptions}
      />
      <AgentDefaultEffortSetting
        value={current?.effort ?? null}
        options={effortOptions}
        disabledLabel={hasExplicitDefault ? EFFORT_NOT_SUPPORTED_LABEL : AGENT_DEFAULT_LABEL}
        onChange={onEffortChange}
      />
    </>
  );
};

function modelOptionLabel(entry: EnabledModelEntry): string {
  const base = entry.name || entry.baseModelId;
  return entry.credentialState === "missing_key" ? `${base} (${MISSING_KEY_LABEL})` : base;
}
