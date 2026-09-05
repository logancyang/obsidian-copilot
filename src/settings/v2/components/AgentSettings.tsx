import {
  AgentDefaultModelSetting,
  backendDisplayOrder,
  backendNeedsSelfHostWarning,
  InstallBadge,
  useBackendInstallState,
  useManagedInstallActionState,
  type BackendDescriptor,
} from "@/agentMode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingItem } from "@/components/ui/setting-item";
import { playNotificationSound } from "@/utils/notificationSound";
import {
  NOTIFICATION_SOUND_OPTIONS,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";
import { SettingSection } from "@/components/ui/setting-section";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { TruncatedText } from "@/components/TruncatedText";
import { usePlugin } from "@/contexts/PluginContext";
import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import { logError } from "@/logger";
import { setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { formatBinaryPathForDisplay } from "@/utils/binaryPath";
import { AlertTriangle, MessageCircle } from "lucide-react";
import React from "react";
import { ChatModelEnableList } from "./ChatModelEnableList";
import { ConfiguredModelEnableList } from "./ConfiguredModelEnableList";
import { AgentNotificationSoundSettings } from "./ui/AgentNotificationSoundSettings";

/** Synthetic sub-tab id for the (non-backend) Quick Chat model curation. */
const QUICK_CHAT_TAB_ID = "quickchat";

/** Nearest scrollable ancestor, used to keep the tab strip anchored on switch. */
function getScrollableParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The "Agents" section of the Basic settings tab. Owns the global
 * default-backend picker and a sub-tab strip with one panel per backend plus a
 * Quick Chat panel. Each backend panel curates that backend's default model,
 * enabled models, and binary/auth config.
 *
 * Desktop-only: the caller must gate on `isDesktopRuntime()` before rendering
 * this, because the `@/agentMode` barrel it imports pulls in Node-only modules.
 */
export const AgentSettings: React.FC = () => {
  const settings = useSettingsValue();
  const plugin = usePlugin();
  const [selectedTab, setSelectedTab] = React.useState<string>(() => backendDisplayOrder()[0].id);
  const tabStripRef = React.useRef<HTMLDivElement>(null);
  const pendingAnchorTop = React.useRef<number | null>(null);

  // Panels vary widely in height (opencode's model list is long, Quick Chat is
  // short), so switching to a shorter one clamps the settings scroll and jumps
  // the view. Pin the tab strip to its pre-switch viewport position so only the
  // content below it changes.
  React.useLayoutEffect(() => {
    const strip = tabStripRef.current;
    if (!strip || pendingAnchorTop.current === null) return;
    const scroller = getScrollableParent(strip);
    if (scroller) {
      const delta = strip.getBoundingClientRect().top - pendingAnchorTop.current;
      if (delta !== 0) scroller.scrollTop += delta;
    }
    pendingAnchorTop.current = null;
  }, [selectedTab]);

  const handleSelectTab = React.useCallback((id: string) => {
    pendingAnchorTop.current = tabStripRef.current?.getBoundingClientRect().top ?? null;
    setSelectedTab(id);
  }, []);

  // Every registered backend shows here — Self-Host Mode marks cloud agents
  // (warning banner in their panel) rather than hiding them. Cloud agents sort
  // last because `backendDisplayOrder()` lists the self-hostable opencode first.
  const orderedDescriptors = backendDisplayOrder();

  const tabs: TabItemType[] = [
    ...orderedDescriptors.map((d) => ({
      id: d.id,
      icon: <d.Icon className="tw-size-4" />,
      label: d.displayName,
    })),
    { id: QUICK_CHAT_TAB_ID, icon: <MessageCircle className="tw-size-4" />, label: "Quick Chat" },
  ];

  // Guard against a persisted selection naming a removed backend id (unrelated
  // to Self-Host Mode, which no longer hides tabs): fall back to the first tab.
  const selectedTabId = tabs.some((tab) => tab.id === selectedTab) ? selectedTab : tabs[0].id;

  // Same unknown-id guard for the persisted `activeBackend`.
  const activeBackendValue = orderedDescriptors.some(
    (d) => d.id === settings.agentMode.activeBackend
  )
    ? settings.agentMode.activeBackend
    : orderedDescriptors[0].id;

  return (
    <section className="tw-space-y-4">
      <SettingSection label="Agents">
        <SettingItem
          type="select"
          title="Default backend"
          description="Used when you click + to start a new session and for auto-spawn on mount. Selecting a model from the model picker also updates this."
          value={activeBackendValue}
          onChange={(value) =>
            setSettings((cur) => ({ agentMode: { ...cur.agentMode, activeBackend: value } }))
          }
          options={orderedDescriptors.map((d) => ({ label: d.displayName, value: d.id }))}
        />
        <AgentNotificationSoundSettings
          enabled={settings.agentMode.notificationSound}
          onEnabledChange={(enabled) =>
            setSettings((cur) => ({ agentMode: { ...cur.agentMode, notificationSound: enabled } }))
          }
          onSoundChange={(value) => {
            if (!isNotificationSoundId(value)) return;
            setSettings((cur) => ({
              agentMode: { ...cur.agentMode, notificationSoundId: value },
            }));
            playNotificationSound(value);
          }}
          soundId={settings.agentMode.notificationSoundId}
          soundOptions={NOTIFICATION_SOUND_OPTIONS}
        />
      </SettingSection>

      <div className="tw-flex tw-flex-col">
        <div ref={tabStripRef} className="tw-flex tw-flex-wrap tw-gap-1" role="tablist">
          {tabs.map((tab, index) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isSelected={selectedTabId === tab.id}
              onClick={() => handleSelectTab(tab.id)}
              isFirst={index === 0}
              isLast={index === tabs.length - 1}
              variant="inline"
            />
          ))}
        </div>

        {orderedDescriptors.map((descriptor) => (
          <TabContent
            key={descriptor.id}
            id={descriptor.id}
            isSelected={selectedTabId === descriptor.id}
            variant="inline"
          >
            <BackendPanel descriptor={descriptor} plugin={plugin} />
          </TabContent>
        ))}
        <TabContent
          id={QUICK_CHAT_TAB_ID}
          isSelected={selectedTabId === QUICK_CHAT_TAB_ID}
          variant="inline"
        >
          <QuickChatPanel />
        </TabContent>
      </div>
    </section>
  );
};

/**
 * Quick Chat curation panel: which models appear in the (non-agent) chat model
 * picker. Lives under Agents per the model-management design (chat is a
 * first-class curation backend alongside the agents). Models come from the
 * BYOK / Plus registries — chat doesn't own providers.
 */
const QuickChatPanel: React.FC = () => {
  const settings = useSettingsValue();
  const { options: chatModelOptions, resolveSelectionId } = useChatBackendModelOptions();
  const resolvedDefaultModelId = resolveSelectionId(settings.defaultModelKey);
  const hasDefault = resolvedDefaultModelId !== undefined;

  return (
    <SettingSection>
      <div className="tw-flex tw-min-w-0 tw-flex-col tw-py-4">
        <span className="tw-text-base tw-font-semibold">Quick Chat models</span>
        <span className="tw-text-xs tw-text-muted">
          Models shown in the chat model picker. Add providers on the Models (BYOK) tab.
        </span>
      </div>
      <SettingItem
        type="select"
        title="Default model"
        description="The model new chats start with. Pick from your enabled Quick Chat models."
        value={resolvedDefaultModelId ?? "Select Model"}
        onChange={(value) => {
          if (value === "Select Model") return;
          updateSetting("defaultModelKey", value);
        }}
        options={
          hasDefault
            ? chatModelOptions
            : [{ label: "Select Model", value: "Select Model" }, ...chatModelOptions]
        }
        placeholder="Model"
      />
      <div className="tw-py-4">
        <ChatModelEnableList />
      </div>
    </SettingSection>
  );
};

/**
 * One per-backend panel: install header, then (when ready) the default-model
 * picker above the model enable list, then the binary/auth config. If the
 * backend is installed but no catalog is cached yet, it kicks a probe so
 * discovery enrolls the reported models, which then populate the list (the
 * list reads the model-management registry, not the probe state).
 */
const BackendPanel: React.FC<{
  descriptor: BackendDescriptor;
  plugin: ReturnType<typeof usePlugin>;
}> = ({ descriptor, plugin }) => {
  const settings = useSettingsValue();
  const Panel = descriptor.SettingsPanel;
  const manager = plugin.agentSessionManager;

  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const resolvedPath = descriptor.getResolvedBinaryPath?.(settings) ?? null;
  const canUpdate = installState.kind === "incompatible" && descriptor.managedInstall !== undefined;
  const updating = managedInstall.kind === "running";
  const updateFailed = managedInstall.kind === "error";

  const runManagedInstall = React.useCallback(() => {
    if (!descriptor.managedInstall || updating) return;
    descriptor.managedInstall
      .run(plugin)
      .catch((error) => logError(`[AgentMode] ${descriptor.id} update failed`, error));
  }, [descriptor, plugin, updating]);

  // Probe when ready but uncached — the load-time preload may have skipped this
  // backend (binary installed after plugin start).
  React.useEffect(() => {
    if (!manager) return;
    if (installState.kind !== "ready") return;
    if (manager.getCachedModelCatalog(descriptor.id)) return;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }, [manager, descriptor.id, installState.kind]);

  const Icon = descriptor.Icon;
  const showCloudWarning = backendNeedsSelfHostWarning(descriptor, settings);
  // Only a backend the plugin can install itself offers inline actions, and
  // that is also the only kind whose models run on the user's own keys — so the
  // same condition gates the recommendation and the BYOK hint. A vendor backend
  // (claude, codex) authenticates against its own subscription, where "add
  // providers on the BYOK tab" would be wrong advice.
  const InlineInstall =
    installState.kind === "absent" ? descriptor.AbsentInstallActions : undefined;

  return (
    <div className="tw-space-y-3">
      {showCloudWarning && (
        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-px-3 tw-py-2.5 tw-text-xs tw-text-normal tw-bg-warning/10 tw-border-warning/40">
          <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning" />
          <div className="tw-leading-relaxed">
            <span className="tw-font-semibold">Cloud service.</span> Self-Host Mode is on, but{" "}
            {descriptor.displayName} runs in the cloud — your prompts leave your machine for a third
            party. It stays available; use it only if you're comfortable with that.
          </div>
        </div>
      )}
      {/* One card per panel, rows divided by `SettingSection`. It insets and
          divides its DIRECT children, so each block below has to be a single
          row-shaped element carrying its own vertical padding — the rows that
          come from `SettingItem` / `EnvOverridesSetting` already do. The cloud
          warning stays outside: it qualifies the whole backend, not one row. */}
      <SettingSection>
        <div className="tw-flex tw-flex-col tw-gap-2 tw-py-4">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
              <Icon className="tw-size-4 tw-shrink-0" />
              <div className="tw-flex tw-min-w-0 tw-flex-col">
                <div className="tw-flex tw-items-center tw-gap-2">
                  <span className="tw-text-base tw-font-semibold">{descriptor.displayName}</span>
                  <InstallBadge state={installState} />
                  {InlineInstall && (
                    <Badge variant="accent" className="tw-font-normal">
                      Recommended
                    </Badge>
                  )}
                </div>
                {resolvedPath && (
                  <TruncatedText className="tw-max-w-[90%] tw-font-mono tw-text-xs tw-text-muted">
                    {formatBinaryPathForDisplay(resolvedPath)}
                  </TruncatedText>
                )}
                {InlineInstall && (
                  <span className="tw-text-xs tw-text-muted">
                    Not installed — one download away.
                  </span>
                )}
                {(installState.kind === "incompatible" || installState.kind === "error") && (
                  <span className="tw-text-xs tw-text-error">
                    {canUpdate && updating
                      ? `${managedInstall.label} ${managedInstall.percent}%`
                      : canUpdate && updateFailed
                        ? managedInstall.message
                        : installState.message}
                  </span>
                )}
              </div>
            </div>
            {InlineInstall ? (
              <InlineInstall plugin={plugin} />
            ) : canUpdate ? (
              <Button
                className="tw-shrink-0"
                size="default"
                disabled={updating}
                onClick={runManagedInstall}
              >
                {updating ? "Updating…" : updateFailed ? "Retry" : "Update"}
              </Button>
            ) : (
              <Button
                className="tw-shrink-0"
                size="default"
                variant={installState.kind === "ready" ? "secondary" : "default"}
                onClick={() => descriptor.openInstallUI(plugin)}
              >
                Configure
              </Button>
            )}
          </div>
          {InlineInstall && (
            <div className="tw-text-xs tw-text-muted">
              Works with Copilot Plus or your own API keys — add providers on the BYOK tab.
            </div>
          )}
        </div>

        {installState.kind === "ready" && manager && (
          <AgentDefaultModelSetting descriptor={descriptor} manager={manager} />
        )}

        {installState.kind === "ready" && (
          <div className="tw-py-4">
            <ConfiguredModelEnableList descriptor={descriptor} />
          </div>
        )}

        {Panel && <Panel plugin={plugin} app={plugin.app} />}
      </SettingSection>
    </div>
  );
};
