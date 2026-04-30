import {
  buildEffortAdapter,
  dedupeAvailableModels,
  getBackendModelOverrides,
  isAgentModelEnabled,
  listBackendDescriptors,
  McpServersPanel,
  type BackendDescriptor,
  type BackendId,
  type EffortAdapter,
} from "@/agentMode";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { SettingItem } from "@/components/ui/setting-item";
import { usePlugin } from "@/contexts/PluginContext";
import { logError } from "@/logger";
import {
  setSettings,
  updateAgentModeBackendFields,
  useSettingsValue,
  type CopilotSettings,
} from "@/settings/model";
import type { ModelInfo } from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";
import React from "react";

/**
 * Explicit ordering for backend sections. Keeps Opencode → Claude Code →
 * Codex regardless of what `listBackendDescriptors()` returns.
 */
const BACKEND_ORDER: BackendId[] = ["opencode", "claude-code", "codex"];

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

  const [cached, setCached] = React.useState(() => manager?.getCachedModels(descriptor.id) ?? null);
  const [cachedConfigOptions, setCachedConfigOptions] = React.useState(
    () => manager?.getCachedConfigOptions(descriptor.id) ?? null
  );
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribeModelCache(() => {
      setCached(manager.getCachedModels(descriptor.id) ?? null);
      setCachedConfigOptions(manager.getCachedConfigOptions(descriptor.id) ?? null);
    });
  }, [manager, descriptor.id]);

  const installState = descriptor.getInstallState(settings);

  // Trigger a probe when the install is ready but no cache has arrived — the
  // load-time preload may have skipped this backend (binary installed after
  // plugin start).
  React.useEffect(() => {
    if (!manager) return;
    if (installState.kind !== "ready") return;
    if (cached) return;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }, [manager, descriptor.id, installState.kind, cached]);

  const overrides = getBackendModelOverrides(settings, descriptor.id);

  return (
    <div className="tw-space-y-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3">
      <div className="tw-text-base tw-font-semibold">{descriptor.displayName}</div>

      {Panel && <Panel plugin={plugin} app={plugin.app} />}

      {installState.kind === "ready" && (
        <ModelCurationBlock
          descriptor={descriptor}
          available={cached?.availableModels ?? null}
          overrides={overrides}
          configOptions={cachedConfigOptions}
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
  available: ReadonlyArray<ModelInfo> | null;
  overrides: Record<string, boolean> | undefined;
  configOptions: Parameters<typeof buildEffortAdapter>[1]["configOptions"];
}> = ({ descriptor, available, overrides, configOptions }) => {
  const settings = useSettingsValue();
  if (!available || available.length === 0) {
    return (
      <div className="tw-text-sm tw-text-muted">
        No models reported yet — install the binary and reload, or open a chat session with this
        agent.
      </div>
    );
  }

  // Collapse effort-suffix variants into one row per base so the toggles
  // operate on the same id surface as the chat picker.
  const collapsed = dedupeAvailableModels(available, descriptor);
  const enabledModels: ModelInfo[] = [];
  const rows = collapsed.map((m) => {
    const isEnabled = isAgentModelEnabled(descriptor, m, overrides);
    if (isEnabled) enabledModels.push(m);
    return { m, isEnabled };
  });

  return (
    <div className="tw-space-y-3">
      <div>
        <div className="tw-mb-2 tw-text-sm tw-font-medium">Available models</div>
        <div className="tw-space-y-1">
          {rows.map(({ m, isEnabled }) => {
            const description = m.description?.trim();
            return (
              <div
                key={m.modelId}
                className="tw-flex tw-items-center tw-justify-between tw-rounded tw-px-2 tw-py-1 hover:tw-bg-modifier-hover"
              >
                <div className="tw-min-w-0">
                  <div className="tw-truncate">{m.name || m.modelId}</div>
                  {description && (
                    <div className="tw-truncate tw-text-xs tw-text-muted">{description}</div>
                  )}
                </div>
                <SettingSwitch
                  checked={isEnabled}
                  onCheckedChange={(next) =>
                    writeOverride(settings, descriptor.id, m.modelId, next)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <DefaultModelPicker descriptor={descriptor} collapsed={collapsed} enabled={enabledModels} />

      <DefaultEffortPicker
        descriptor={descriptor}
        available={available}
        configOptions={configOptions}
      />
    </div>
  );
};

/**
 * Default-model dropdown — limited to enabled models, persists via the
 * descriptor's `persistModelSelection`. For backends where effort is
 * encoded in the model id (opencode/codex), this writes the bare base-id
 * and lets `DefaultEffortPicker` recompose with effort if the user picks
 * one.
 */
const DefaultModelPicker: React.FC<{
  descriptor: BackendDescriptor;
  collapsed: ModelInfo[];
  enabled: ModelInfo[];
}> = ({ descriptor, collapsed, enabled }) => {
  const settings = useSettingsValue();
  const plugin = usePlugin();

  const currentPreferredAgentId = descriptor.getPreferredModelId?.(settings);
  // Translate the preferred id (which may include an effort suffix) back to
  // its base so the dropdown matches one of the collapsed rows.
  const currentBaseId = currentPreferredAgentId
    ? (descriptor.parseEffortFromModelId?.(currentPreferredAgentId)?.baseId ??
      currentPreferredAgentId)
    : "";

  // If the persisted default is currently disabled by override/policy, keep
  // it visible in the dropdown so the user isn't stranded — picking it
  // again has no effect, but switching off it works as expected.
  const currentEntry =
    currentBaseId && !enabled.some((m) => m.modelId === currentBaseId)
      ? collapsed.find((m) => m.modelId === currentBaseId)
      : undefined;
  const dropdownEntries = currentEntry ? [currentEntry, ...enabled] : enabled;
  if (dropdownEntries.length === 0) return null;

  const handleChange = (newBaseId: string): void => {
    if (!newBaseId) return;
    // Preserve the user's existing effort selection when switching base
    // models on opencode/codex-style backends.
    const existingEffort = currentPreferredAgentId
      ? (descriptor.parseEffortFromModelId?.(currentPreferredAgentId)?.effort ?? null)
      : null;
    const composed = descriptor.composeModelId
      ? descriptor.composeModelId(newBaseId, existingEffort)
      : newBaseId;
    descriptor
      .persistModelSelection?.(composed, plugin)
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
        ...dropdownEntries.map((m) => ({ label: m.name || m.modelId, value: m.modelId })),
      ]}
    />
  );
};

/**
 * Default-effort dropdown — uses the same `EffortAdapter` shape as the chat
 * picker. For opencode/codex this recomposes the model id and persists via
 * `persistModelSelection`; for claude-code it persists via
 * `persistEffortSelection`. Hidden when the backend doesn't expose effort.
 */
const DefaultEffortPicker: React.FC<{
  descriptor: BackendDescriptor;
  available: ReadonlyArray<ModelInfo>;
  configOptions: Parameters<typeof buildEffortAdapter>[1]["configOptions"];
}> = ({ descriptor, available, configOptions }) => {
  const settings = useSettingsValue();
  const plugin = usePlugin();

  // Build a synthetic SessionModelState pointing at the user's persisted
  // default (or the first available model) so `buildEffortAdapter` can
  // surface the right variants without needing a live session.
  const preferredId = descriptor.getPreferredModelId?.(settings);
  const currentModelId = preferredId ?? available[0]?.modelId ?? "";
  if (!currentModelId) return null;

  const adapter: EffortAdapter | null = buildEffortAdapter(descriptor, {
    modelState: { availableModels: [...available], currentModelId },
    configOptions,
  });
  if (!adapter) return null;

  // Native <select> can't represent `null` directly. Map the bare/"Default"
  // option to the empty string for the DOM, recover it on write.
  const currentValue = adapter.currentValue ?? "";
  const handleChange = (raw: string): void => {
    const value = raw === "" ? null : raw;
    if (adapter.kind === "model") {
      // Recompose the model id and persist as the new default model. We
      // don't touch any live session — this is a default for the next
      // session.
      const parsed = descriptor.parseEffortFromModelId?.(currentModelId);
      const baseId = parsed?.baseId ?? currentModelId;
      const composed = descriptor.composeModelId?.(baseId, value) ?? baseId;
      descriptor
        .persistModelSelection?.(composed, plugin)
        .catch((e) =>
          logError(`[AgentMode] persist default effort (model) ${descriptor.id} failed`, e)
        );
      return;
    }
    // configOption-style: persist as a separate sticky effort. The bare
    // option doesn't exist for these backends; treat null as a no-op.
    if (value === null) return;
    descriptor
      .persistEffortSelection?.(value, plugin)
      .catch((e) =>
        logError(`[AgentMode] persist default effort (configOption) ${descriptor.id} failed`, e)
      );
  };

  return (
    <SettingItem
      type="select"
      title="Default effort"
      description="Reasoning effort applied when starting a new session."
      value={currentValue}
      onChange={handleChange}
      options={adapter.options.map((o) => ({ label: o.label, value: o.value ?? "" }))}
    />
  );
};

/**
 * Atomic per-backend slice update for a single model toggle. Composes the
 * next `modelEnabledOverrides` map by reading the previous one off the
 * current settings; `updateAgentModeBackendFields` merges it back in.
 */
function writeOverride(
  settings: ReturnType<typeof useSettingsValue>,
  backendId: BackendId,
  modelId: string,
  enabled: boolean
): void {
  const prev = getBackendModelOverrides(settings, backendId) ?? {};
  const next: Record<string, boolean> = { ...prev, [modelId]: enabled };
  // `BackendId` is widened to `string` at the agentMode layer boundary;
  // narrow to the literal-keyed `backends` shape for the typed updater.
  type BackendKey = keyof CopilotSettings["agentMode"]["backends"];
  updateAgentModeBackendFields(backendId as BackendKey, { modelEnabledOverrides: next });
}
