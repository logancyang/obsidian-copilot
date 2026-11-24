import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { MiyoLogo } from "@/miyo/ui/MiyoLogo";
import {
  SettingTabStrip,
  TabContent,
  type TabItem as TabItemType,
} from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/settings/v2/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import CopilotPlugin from "@/main";
import { ByokPanel, ModelManagementProvider } from "@/modelManagement";
import { getSettings, resetSettings } from "@/settings/model";
import { COPILOT_SETTINGS_TAB_IDS, type CopilotSettingsTabId } from "@/settings/settingsTabs";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { ConnectorsSettings } from "@/settings/v2/components/ConnectorsSettings";
import { useIsConnectorsEnabled } from "@/connectors/connectorsEntitlement";
import { useConnectorsSnapshot } from "@/connectors/ui/useConnectorsSnapshot";
import { Cog, Command, Cpu, Plug, ShieldCheck, Sparkle, Wrench } from "lucide-react";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { DesktopOnlySettingsPanel } from "./components/DesktopOnlySettingsPanel";
import { MiyoSettings } from "@/miyo/settings/MiyoSettings";
import { SelfHostSettings } from "./components/SelfHostSettings";
import { SettingsSubPageHost } from "./SettingsSubPage";

const LazySkillsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.SkillsSettings }))
);

const SkillsSettingsPanel: React.FC<React.ComponentProps<typeof LazySkillsSettings>> = (props) => {
  if (!isDesktopRuntime()) {
    return <DesktopOnlySettingsPanel message="Skills are available on desktop." />;
  }
  return (
    <React.Suspense fallback={null}>
      <LazySkillsSettings {...props} />
    </React.Suspense>
  );
};

const icons: Record<CopilotSettingsTabId, JSX.Element> = {
  basic: <Cog className="tw-size-5" />,
  byok: <Cpu className="tw-size-5" />,
  miyo: <MiyoLogo className="tw-size-5" />,
  selfhost: <ShieldCheck className="tw-size-5" />,
  command: <Command className="tw-size-5" />,
  skills: <Sparkle className="tw-size-5" />,
  connectors: <Plug className="tw-size-5" />,
  advanced: <Wrench className="tw-size-5" />,
};

const TAB_LABELS: Record<CopilotSettingsTabId, string> = {
  basic: "Basic",
  byok: "BYOK",
  miyo: "Miyo",
  selfhost: "Self-Host",
  command: "Commands",
  skills: "Skills",
  connectors: "Connectors",
  advanced: "Advanced",
};

const tabs = COPILOT_SETTINGS_TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: TAB_LABELS[id],
})) satisfies TabItemType[];

interface SettingsContentProps {
  plugin: CopilotPlugin;
}

const SettingsContent: React.FC<SettingsContentProps> = ({ plugin }) => {
  const { selectedTab, setSelectedTab } = useTab();
  const skillLoadErrorCount = useSkillLoadErrorCount();
  const connectorsSnapshot = useConnectorsSnapshot(plugin.connectionManager);
  const connectorsEnabled = useIsConnectorsEnabled();
  const connectorsNeedAttention =
    connectorsSnapshot?.needsAttention === true && connectorsEnabled !== false;

  const isPluginLifecycleActive = React.useCallback(
    () => plugin.isPluginLifecycleActive(),
    [plugin]
  );
  const newAgentChatWithDraft = React.useCallback(
    (draft: string) => void plugin.newAgentChatWithDraft(draft),
    [plugin]
  );
  const openReportIssue = React.useCallback(() => {
    void import("@/agentMode").then(({ openReportIssueModal }) => {
      openReportIssueModal(plugin, {
        activeBackend:
          plugin.agentSessionManager?.getActiveSession()?.backendId ??
          getSettings().agentMode.activeBackend,
      });
    });
  }, [plugin]);

  const panels: Record<CopilotSettingsTabId, React.ReactNode> = {
    basic: (
      <BasicSettings
        agentSettings={{
          agentSessionManager: plugin.agentSessionManager,
          manifest: plugin.manifest,
        }}
      />
    ),
    byok: <ByokPanel />,
    miyo: <MiyoSettings isPluginLifecycleActive={isPluginLifecycleActive} />,
    selfhost: <SelfHostSettings />,
    command: <CommandSettings />,
    skills: <SkillsSettingsPanel newAgentChatWithDraft={newAgentChatWithDraft} />,
    connectors: (
      <ConnectorsSettings
        connectionManager={plugin.connectionManager}
        connectorTools={plugin.connectorTools}
        customConnectors={plugin.customConnectors}
      />
    ),
    advanced: <AdvancedSettings onReportIssue={openReportIssue} />,
  };

  return (
    <div className="tw-flex tw-flex-col">
      <SettingTabStrip
        tabs={tabs.map((tab) => ({
          ...tab,
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
          // The tab strip stays mounted while inactive panels do not, so
          // load failures remain visible from every settings section.
          warningLabel:
            tab.id === "skills" && skillLoadErrorCount > 0
              ? "Some skills failed to load"
              : tab.id === "connectors" && connectorsNeedAttention
                ? "You have connectors that need your attention"
                : undefined,
        }))}
        selectedId={selectedTab}
        onSelect={setSelectedTab}
      />
      <div className="tw-w-full tw-border tw-border-solid" />

      <div>
        {COPILOT_SETTINGS_TAB_IDS.map((id) => (
          <TabContent key={id} id={id} isSelected={selectedTab === id}>
            {panels[id]}
          </TabContent>
        ))}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: CopilotPlugin;
  initialTab?: CopilotSettingsTabId;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin, initialTab = "basic" }) => {
  const [resetKey, setResetKey] = React.useState(0);
  const { latestVersion, hasUpdate } = useLatestVersion(plugin.manifest.version);

  React.useEffect(() => {
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
    // Agent repairs can change hidden files while the window stays focused and
    // the Skills panel is unmounted. Refresh when Settings next opens so its tab
    // marker never depends on visiting the Skills panel first.
    void plugin.skills?.refresh();
  }, [plugin]);

  const handleReset = () => {
    const modal = new ResetSettingsConfirmModal(plugin.app, () => {
      resetSettings();
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <ModelManagementProvider api={plugin.modelManagement}>
      <TabProvider initialTab={initialTab}>
        <SettingsSubPageHost className="tw-mx-auto tw-max-w-[860px]">
          <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
            <div
              role="heading"
              aria-level={1}
              className="tw-flex tw-flex-col tw-gap-2 tw-text-base tw-font-semibold sm:tw-flex-row sm:tw-items-center sm:tw-justify-between"
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <span>Copilot settings</span>
                <div className="tw-flex tw-items-center tw-gap-1">
                  <span className="tw-text-xs tw-font-normal tw-text-muted">
                    v{plugin.manifest.version}
                  </span>
                  {latestVersion && (
                    <>
                      {hasUpdate ? (
                        <a
                          href="obsidian://show-plugin?id=copilot"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tw-text-xs tw-font-normal tw-text-accent hover:tw-underline"
                        >
                          (Update to v{latestVersion})
                        </a>
                      ) : (
                        <span className="tw-text-xs tw-font-normal tw-text-normal">
                          {" "}
                          (up to date)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="tw-self-end sm:tw-self-auto">
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  Reset settings
                </Button>
              </div>
            </div>
          </div>
          <SettingsContent key={resetKey} plugin={plugin} />
        </SettingsSubPageHost>
      </TabProvider>
    </ModelManagementProvider>
  );
};

export default SettingsMainV2;
