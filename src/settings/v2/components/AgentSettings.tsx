import {
  AgentBackendHeader,
  AgentDefaultModelSetting,
  backendDisplayOrder,
  backendNeedsSelfHostWarning,
  useBackendInstallState,
  useBackendAuthState,
  useManagedInstallActionState,
  type BackendDescriptor,
} from "@/agentMode";
import { SettingItem } from "@/components/ui/setting-item";
import { playNotificationSound } from "@/utils/notificationSound";
import {
  NOTIFICATION_SOUND_OPTIONS,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";
import { SettingSection } from "@/components/ui/setting-section";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { usePlugin } from "@/contexts/PluginContext";
import { logError } from "@/logger";
import { setSettings, useSettingsValue } from "@/settings/model";
import { formatBinaryPathForDisplay } from "@/utils/binaryPath";
import { AlertTriangle, MessageCircle } from "lucide-react";
import React from "react";
import { QuickChatPanel } from "./QuickChatPanel";
import { ConfiguredModelEnableList } from "./ConfiguredModelEnableList";
import { AgentNotificationSoundSettings } from "./ui/AgentNotificationSoundSettings";

const QUICK_CHAT_TAB_ID = "quickchat";

function getScrollableParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export const AgentSettings: React.FC = () => {
  const settings = useSettingsValue();
  const plugin = usePlugin();
  const [selectedTab, setSelectedTab] = React.useState<string>(() => backendDisplayOrder()[0].id);
  const tabStripRef = React.useRef<HTMLDivElement>(null);
  const pendingAnchorTop = React.useRef<number | null>(null);

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

  const orderedDescriptors = backendDisplayOrder();

  const tabs: TabItemType[] = [
    ...orderedDescriptors.map((d) => ({
      id: d.id,
      icon: <d.Icon className="tw-size-4" />,
      label: d.displayName,
    })),
    { id: QUICK_CHAT_TAB_ID, icon: <MessageCircle className="tw-size-4" />, label: "Quick Chat" },
  ];

  const selectedTabId = tabs.some((tab) => tab.id === selectedTab) ? selectedTab : tabs[0].id;

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

const BackendPanel: React.FC<{
  descriptor: BackendDescriptor;
  plugin: ReturnType<typeof usePlugin>;
}> = ({ descriptor, plugin }) => {
  const settings = useSettingsValue();
  const Panel = descriptor.SettingsPanel;
  const manager = plugin.agentSessionManager;

  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);
  const resolvedPath = descriptor.getResolvedBinaryPath?.(settings) ?? null;

  React.useEffect(() => {
    if (!manager) return;
    if (installState.kind !== "ready") return;
    if (manager.getCachedModelCatalog(descriptor.id)) return;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }, [manager, descriptor.id, installState.kind]);

  const showCloudWarning = backendNeedsSelfHostWarning(descriptor, settings);

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
      <SettingSection>
        <AgentBackendHeader
          displayName={descriptor.displayName}
          Icon={descriptor.Icon}
          installState={installState}
          authStatus={descriptor.auth ? auth.status : undefined}
          managedInstall={managedInstall}
          resolvedPath={resolvedPath ? formatBinaryPathForDisplay(resolvedPath) : null}
          onConfigure={() => descriptor.openInstallUI(plugin)}
        />

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
