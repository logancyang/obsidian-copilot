import {
  InstallBadge,
  listBackendDescriptors,
  McpServersPanel,
  type BackendDescriptor,
  type BackendId,
} from "@/agentMode";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { usePlugin } from "@/contexts/PluginContext";
import { logError } from "@/logger";
import { setSettings, useSettingsValue } from "@/settings/model";
import { Platform } from "obsidian";
import React from "react";
import { ConfiguredModelEnableList } from "./ConfiguredModelEnableList";

/**
 * Explicit ordering for backend sections. Keeps Opencode → Claude → Codex
 * regardless of what `listBackendDescriptors()` returns.
 */
const BACKEND_ORDER: BackendId[] = ["opencode", "claude", "codex"];

/**
 * Top-level "Agents" settings tab. Owns the master agent-mode toggle, the
 * default backend picker, the MCP server panel, and one per-backend section
 * (binary path + model curation).
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
          type="select"
          title="Default backend"
          description="Used when you click + to start a new session and for auto-spawn on mount. Selecting a model from the model picker also updates this."
          value={settings.agentMode.activeBackend}
          onChange={(value) =>
            setSettings((cur) => ({ agentMode: { ...cur.agentMode, activeBackend: value } }))
          }
          options={orderedDescriptors.map((d) => ({ label: d.displayName, value: d.id }))}
        />

        <McpServersPanel />

        {orderedDescriptors.map((descriptor) => (
          <BackendSection key={descriptor.id} descriptor={descriptor} plugin={plugin} />
        ))}
      </div>
    </section>
  );
};

/**
 * One per-backend block: heading, binary install panel, and the model enable
 * list. If the backend is installed but no catalog is cached yet, it kicks a
 * probe so discovery enrolls the reported models, which then populate the list
 * (the list reads the model-management registry, not the probe state).
 */
const BackendSection: React.FC<{
  descriptor: BackendDescriptor;
  plugin: ReturnType<typeof usePlugin>;
}> = ({ descriptor, plugin }) => {
  const settings = useSettingsValue();
  const Panel = descriptor.SettingsPanel;
  const manager = plugin.agentSessionManager;

  const installState = descriptor.getInstallState(settings);

  // Probe when ready but uncached — the load-time preload may have skipped this
  // backend (binary installed after plugin start).
  React.useEffect(() => {
    if (!manager) return;
    if (installState.kind !== "ready") return;
    if (manager.getCachedBackendState(descriptor.id)?.model) return;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }, [manager, descriptor.id, installState.kind]);

  const Icon = descriptor.Icon;

  return (
    <div className="tw-space-y-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-2">
          <Icon className="tw-size-4" />
          <span className="tw-text-base tw-font-semibold">{descriptor.displayName}</span>
          <InstallBadge state={installState} />
        </div>
        <Button
          size="default"
          variant={installState.kind === "ready" ? "secondary" : "default"}
          onClick={() => descriptor.openInstallUI(plugin)}
        >
          Configure
        </Button>
      </div>

      {installState.kind === "ready" && <ConfiguredModelEnableList descriptor={descriptor} />}

      {Panel && <Panel plugin={plugin} app={plugin.app} />}
    </div>
  );
};
