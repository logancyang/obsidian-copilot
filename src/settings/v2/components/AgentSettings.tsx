import {
  getBackendModelOverrides,
  isAgentModelEnabled,
  listBackendDescriptors,
  McpServersPanel,
  SelectedModelsList,
  type BackendDescriptor,
  type BackendId,
  type BackendState,
  type ModelEntry,
} from "@/agentMode";
import { SettingItem } from "@/components/ui/setting-item";
import { usePlugin } from "@/contexts/PluginContext";
import { logError } from "@/logger";
import { setSettings, useSettingsValue } from "@/settings/model";
import { Platform } from "obsidian";
import React from "react";

/**
 * Explicit ordering for backend sections. Keeps Opencode → Claude → Codex
 * regardless of what `listBackendDescriptors()` returns.
 */
const BACKEND_ORDER: BackendId[] = ["opencode", "claude", "codex"];

/**
 * Top-level "Agents" settings tab. Owns the master agent-mode toggle, the
 * default backend picker, the MCP server panel, and one per-backend section
 * (binary path + model curation + default model/effort).
 */
export const AgentSettings: React.FC = () => {
  const settings = useSettingsValue();
  const plugin = usePlugin();

  if (Platform.isMobile) {
    return (
      <section>
        <div className="tw-mb-3 tw-text-xl tw-font-bold">Agents</div>
        <div className="tw-text-muted">
          Agent Mode is desktop only. Open the desktop app to configure agents.
        </div>
      </section>
    );
  }

  const allDescriptors = listBackendDescriptors();
  const orderedDescriptors = BACKEND_ORDER.map((id) =>
    allDescriptors.find((d) => d.id === id)
  ).filter((d): d is BackendDescriptor => d !== undefined);

  return (
    <section>
      <div className="tw-mb-3 tw-text-xl tw-font-bold">Agents (alpha)</div>
      <div className="tw-space-y-4">
        <SettingItem
          type="switch"
          title="Enable Agent Mode"
          description="BYOK agent harness backed by a local ACP subprocess. Desktop only."
          checked={settings.agentMode.enabled}
          onCheckedChange={(checked) =>
            setSettings((cur) => ({ agentMode: { ...cur.agentMode, enabled: checked } }))
          }
        />

        {settings.agentMode.enabled && (
          <SettingItem
            type="select"
            title="Default backend"
            description="Used when you click + to start a new session and for auto-spawn on mount. Selecting a model from the model picker also updates this."
            value={settings.agentMode.activeBackend}
            onChange={(value) =>
              setSettings((cur) => ({ agentMode: { ...cur.agentMode, activeBackend: value } }))
            }
            options={orderedDescriptors.map((d) => ({ label: d.displayName, value: d.id }))}
          />
        )}

        {settings.agentMode.enabled && <McpServersPanel />}

        {settings.agentMode.enabled &&
          orderedDescriptors.map((descriptor) => (
            <BackendSection key={descriptor.id} descriptor={descriptor} plugin={plugin} />
          ))}
      </div>
    </section>
  );
};

/**
 * One per-backend block: heading, binary install panel, model toggle list,
 * and default model + effort pickers. Subscribes to the preloader cache so
 * the model list and default pickers update as soon as the preloader has
 * results.
 */
const BackendSection: React.FC<{
  descriptor: BackendDescriptor;
  plugin: ReturnType<typeof usePlugin>;
}> = ({ descriptor, plugin }) => {
  const settings = useSettingsValue();
  const Panel = descriptor.SettingsPanel;
  const manager = plugin.agentSessionManager;

  const [backendState, setBackendState] = React.useState<BackendState | null>(
    () => manager?.getCachedBackendState(descriptor.id) ?? null
  );
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribeModelCache(() => {
      setBackendState(manager.getCachedBackendState(descriptor.id) ?? null);
    });
  }, [manager, descriptor.id]);
  const cachedModel = backendState?.model ?? null;

  const installState = descriptor.getInstallState(settings);

  // Trigger a probe when the install is ready but no cache has arrived — the
  // load-time preload may have skipped this backend (binary installed after
  // plugin start).
  React.useEffect(() => {
    if (!manager) return;
    if (installState.kind !== "ready") return;
    if (cachedModel) return;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }, [manager, descriptor.id, installState.kind, cachedModel]);

  const overrides = getBackendModelOverrides(settings, descriptor.id);

  return (
    <div className="tw-space-y-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3">
      <div className="tw-text-base tw-font-semibold">{descriptor.displayName}</div>

      {Panel && <Panel plugin={plugin} app={plugin.app} />}

      {installState.kind === "ready" && (
        <ModelCurationBlock
          descriptor={descriptor}
          backendState={backendState}
          overrides={overrides}
        />
      )}
    </div>
  );
};

/**
 * Renders the "Available models" toggle list plus the default model and
 * default effort dropdowns. Hidden when the preloader hasn't returned a
 * model list yet (still probing or agent reports nothing).
 */
const ModelCurationBlock: React.FC<{
  descriptor: BackendDescriptor;
  backendState: BackendState | null;
  overrides: Record<string, boolean> | undefined;
}> = ({ descriptor, backendState, overrides }) => {
  const modelState = backendState?.model;
  if (!modelState || modelState.availableModels.length === 0) {
    return (
      <div className="tw-text-sm tw-text-muted">
        No models reported yet — install the binary and reload, or open a chat session with this
        agent.
      </div>
    );
  }

  const enabled = modelState.availableModels.filter((entry) =>
    isAgentModelEnabled(descriptor, { modelId: entry.baseModelId, name: entry.name }, overrides)
  );

  return (
    <div className="tw-space-y-3">
      <SelectedModelsList
        descriptor={descriptor}
        availableModels={modelState.availableModels}
        overrides={overrides}
      />

      <DefaultModelPicker
        descriptor={descriptor}
        availableModels={modelState.availableModels}
        enabled={enabled}
      />

      <DefaultEffortPicker descriptor={descriptor} backendState={backendState} />
    </div>
  );
};

/**
 * Default-model dropdown — limited to enabled models. Reads/writes the
 * normalized `{ baseModelId, effort }` preference through the session
 * manager; the picker UI never sees wire format.
 */
const DefaultModelPicker: React.FC<{
  descriptor: BackendDescriptor;
  availableModels: ReadonlyArray<ModelEntry>;
  enabled: ReadonlyArray<ModelEntry>;
}> = ({ descriptor, availableModels, enabled }) => {
  // useSettingsValue() subscribes the component to settings changes — without
  // it, manager.getDefaultSelection (which reads getSettings synchronously)
  // wouldn't trigger a re-render after persistDefaultSelection.
  useSettingsValue();
  const plugin = usePlugin();
  const manager = plugin.agentSessionManager;
  const defaultSelection = manager?.getDefaultSelection(descriptor.id) ?? null;
  const currentBaseId = defaultSelection?.baseModelId ?? "";

  // If the persisted default is currently disabled by override/policy, keep
  // it visible in the dropdown so the user isn't stranded.
  const currentEntry =
    currentBaseId && !enabled.some((m) => m.baseModelId === currentBaseId)
      ? availableModels.find((m) => m.baseModelId === currentBaseId)
      : undefined;
  const dropdownEntries = currentEntry ? [currentEntry, ...enabled] : enabled;
  if (dropdownEntries.length === 0) return null;

  const handleChange = (newBaseId: string): void => {
    if (!newBaseId || !manager) return;
    manager
      .persistDefaultSelection(descriptor.id, {
        baseModelId: newBaseId,
        effort: defaultSelection?.effort ?? null,
      })
      .catch((e) => logError(`[AgentMode] persist default model for ${descriptor.id} failed`, e));
  };

  return (
    <SettingItem
      type="select"
      title="Default model"
      description="Used when starting a new session with this agent."
      value={currentBaseId}
      onChange={handleChange}
      options={[
        { label: "Use agent default", value: "" },
        ...dropdownEntries.map((m) => ({ label: m.name || m.baseModelId, value: m.baseModelId })),
      ]}
    />
  );
};

/**
 * Default-effort dropdown — sources `effortOptions` from the catalog entry
 * for the persisted default model, falling back to the agent's catalog-
 * declared default (`availableModels[0]`) when no preference is set. Never
 * reads `modelState.current.*` so the settings UI doesn't drift with mid-
 * session model switches. Hidden when the target model has no effort
 * dimension or the catalog hasn't loaded yet.
 */
const DefaultEffortPicker: React.FC<{
  descriptor: BackendDescriptor;
  backendState: BackendState | null;
}> = ({ descriptor, backendState }) => {
  // See DefaultModelPicker for why useSettingsValue() is called for its
  // re-render side effect rather than its return value.
  useSettingsValue();
  const plugin = usePlugin();
  const manager = plugin.agentSessionManager;
  const modelState = backendState?.model;
  if (!modelState) return null;

  const defaultSelection = manager?.getDefaultSelection(descriptor.id) ?? null;
  const targetBaseId =
    defaultSelection?.baseModelId ?? manager?.getDefaultBaseModelId(descriptor.id);
  if (!targetBaseId) return null;
  const targetEntry = modelState.availableModels.find((e) => e.baseModelId === targetBaseId);
  if (!targetEntry || targetEntry.effortOptions.length === 0) return null;

  const domValue = defaultSelection?.effort ?? "";
  const handleChange = (raw: string): void => {
    if (!manager) return;
    const value = raw === "" ? null : raw;
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId: targetBaseId, effort: value })
      .catch((e) => logError(`[AgentMode] persist default effort for ${descriptor.id} failed`, e));
  };

  return (
    <SettingItem
      type="select"
      title="Default effort"
      description="Reasoning effort applied when starting a new session."
      value={domValue}
      onChange={handleChange}
      options={targetEntry.effortOptions.map((o) => ({ label: o.label, value: o.value ?? "" }))}
    />
  );
};
