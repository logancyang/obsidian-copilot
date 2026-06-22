import { SettingItem } from "@/components/ui/setting-item";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React, { useSyncExternalStore } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, EnabledModelEntry } from "@/agentMode/session/types";
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

/** Sentinel option representing "no stored default — let the agent choose". */
const AGENT_DEFAULT_VALUE = "__agent_default__";
const AGENT_DEFAULT_LABEL = "Agent default";

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

  // No stored default → the agent's own native default is used for new chats
  // and fan-out (see `AgentSessionManager.createSession`). Represent that
  // explicitly with a sentinel rather than showing a real model as "selected"
  // (which would also let an effort-only change silently persist that model).
  const current = manager.getDefaultSelection(descriptor.id);
  const hasExplicitDefault = current !== null;

  // Hide the control only when there's nothing to manage: no enabled models
  // AND no stored default. A stored default whose model was later disabled
  // must stay visible so the user can clear it — new chats and fan-out still
  // read it via `getDefaultSelection`, so silently hiding it would strand
  // sessions on a model the agent no longer offers.
  if ((!enabled || enabled.length === 0) && !hasExplicitDefault) return null;

  const selectedBaseId = current?.baseModelId ?? AGENT_DEFAULT_VALUE;
  // Only a concrete default exposes an effort row; the agent-default case
  // lets the agent choose effort, so there's nothing to persist.
  const rawEffortOptions = hasExplicitDefault
    ? resolveEffortOptions(manager, descriptor.id, selectedBaseId)
    : EMPTY_EFFORT_OPTIONS;
  // A stored `effort: null` means "let the agent choose". Some catalogs (e.g.
  // Claude's low/medium/high) only enumerate concrete values, so without an
  // explicit unset option the select would render the first concrete effort as
  // selected while the runtime still treats null as the agent default. Prepend
  // an "Agent default" option (the null-valued convention) when the catalog
  // doesn't already carry one.
  const effortOptions =
    rawEffortOptions.length > 0 && !rawEffortOptions.some((o) => o.value === null)
      ? [{ value: null, label: AGENT_DEFAULT_LABEL }, ...rawEffortOptions]
      : rawEffortOptions;

  const onModelChange = (baseModelId: string): void => {
    if (baseModelId === AGENT_DEFAULT_VALUE) {
      manager
        .persistDefaultSelection(descriptor.id, null)
        .catch((e) => logError(`[AgentMode] clear default model for ${descriptor.id} failed`, e));
      return;
    }
    // A model-only change carries no effort choice, so persist the agent
    // default (null) rather than auto-selecting the new model's first concrete
    // effort — that would silently run new chats and fan-out at an effort the
    // user never picked. The user can then pick a concrete effort explicitly.
    // Persisting null also drops any stale effort from the previous model
    // (opencode's effort is model-specific).
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId, effort: null })
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
  // A stored default whose model is no longer enabled must still appear as a
  // selectable option, or the select would render blank and the user couldn't
  // see what they're clearing.
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
      {effortOptions.length > 0 && (
        <SettingItem
          type="select"
          title="Default effort"
          value={current?.effort ?? ""}
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
