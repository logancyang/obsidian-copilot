import { SettingItem } from "@/components/ui/setting-item";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React, { useSyncExternalStore } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, EnabledModelEntry } from "@/agentMode/session/types";
import { MISSING_KEY_LABEL, resolveEffortOptions } from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

interface Props {
  descriptor: BackendDescriptor;
  manager: AgentSessionManager;
}

/**
 * Per-agent "Default model" picker shown in each toggled-on agent's settings
 * section. Sources its options from the agent's enabled (toggled-on) models,
 * and writes the chosen (model, effort) as that backend's durable default via
 * `persistDefaultSelection` — the only writer of `defaultModel`. Every new
 * session and fan-out answerer on this backend starts from it, and an open
 * chat picks it up on the next turn (see `AgentSessionManager`).
 */
export const AgentDefaultModelSetting: React.FC<Props> = ({ descriptor, manager }) => {
  // Re-render when the model cache settles so freshly-probed effort options
  // and model names appear without a settings-tab reopen. The snapshot is a
  // cache signature, not just the preload status, so the post-`"ready"`
  // effort-catalog prefetch still triggers a rerender.
  const subscribe = useManagerSubscribe(manager);
  useSyncExternalStore(
    subscribe,
    () => manager.getModelCacheSignature(descriptor.id),
    () => manager.getModelCacheSignature(descriptor.id)
  );

  const settings = useSettingsValue();
  const enabled = descriptor.getEnabledModelEntries?.(settings) ?? null;
  if (!enabled || enabled.length === 0) return null;

  const current = manager.getDefaultSelection(descriptor.id);
  const selectedBaseId = current?.baseModelId ?? enabled[0].baseModelId;
  const effortOptions = resolveEffortOptions(manager, descriptor.id, selectedBaseId);

  const onModelChange = (baseModelId: string): void => {
    // A stale effort value may not exist on the newly-selected model
    // (opencode's effort is model-specific), so reset it to the new model's
    // first option, or null when it has none.
    const nextEfforts = resolveEffortOptions(manager, descriptor.id, baseModelId);
    const effort = nextEfforts[0]?.value ?? null;
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId, effort })
      .catch((e) => logError(`[AgentMode] persist default model for ${descriptor.id} failed`, e));
  };

  const onEffortChange = (effort: string | null): void => {
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId: selectedBaseId, effort })
      .catch((e) => logError(`[AgentMode] persist default effort for ${descriptor.id} failed`, e));
  };

  return (
    <>
      <SettingItem
        type="select"
        title="Default model"
        description="Used for new chats and multi-agent answers on this agent. Open chats switch on their next turn."
        value={selectedBaseId}
        onChange={onModelChange}
        options={enabled.map((e) => ({ label: modelOptionLabel(e), value: e.baseModelId }))}
      />
      {effortOptions.length > 0 && (
        <SettingItem
          type="select"
          title="Default effort"
          value={current?.effort ?? effortOptions[0]?.value ?? ""}
          onChange={(value) => onEffortChange(value === "" ? null : value)}
          options={effortOptions.map((o) => ({ label: o.label, value: o.value ?? "" }))}
        />
      )}
    </>
  );
};

function modelOptionLabel(entry: EnabledModelEntry): string {
  const base = entry.name || entry.baseModelId;
  // Keep a missing-key model selectable (a default can be set before the key
  // is added) but flag it, mirroring the chat picker's `MISSING_KEY_LABEL`.
  return entry.credentialState === "missing_key" ? `${base} (${MISSING_KEY_LABEL})` : base;
}
