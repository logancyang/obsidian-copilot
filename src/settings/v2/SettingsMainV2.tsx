import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Cog, Command, Cpu, Database, Sparkles, Wrench } from "lucide-react";
import React from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { CopilotPlusSettings } from "./components/CopilotPlusSettings";
import { ModelSettings } from "./components/ModelSettings";
import { QASettings } from "./components/QASettings";

const TAB_IDS = ["basic", "model", "QA", "command", "plus", "advanced"] as const;
type TabId = (typeof TAB_IDS)[number];

// tab icons
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="w-5 h-5" />,
  model: <Cpu className="w-5 h-5" />,
  QA: <Database className="w-5 h-5" />,
  command: <Command className="w-5 h-5" />,
  plus: <Sparkles className="w-5 h-5" />,
  advanced: <Wrench className="w-5 h-5" />,
};

// tab components
const components: Record<TabId, React.FC> = {
  basic: () => <BasicSettings />,
  model: () => <ModelSettings />,
  QA: () => <QASettings />,
  command: () => <CommandSettings />,
  plus: () => <CopilotPlusSettings />,
  advanced: () => <AdvancedSettings />,
};

// tabs
const tabs: TabItemType[] = TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: id.charAt(0).toUpperCase() + id.slice(1),
}));

const SettingsContent: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  const { selectedTab, setSelectedTab } = useTab();

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-inline-flex tw-rounded-lg">
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
            isFirst={index === 0}
            isLast={index === tabs.length - 1}
          />
        ))}
      </div>
      <div className="tw-w-[100%] tw-border tw-border-solid" />

      <div>
        {TAB_IDS.map((id) => {
          const Component = components[id];
          return (
            <TabContent key={id} id={id} isSelected={selectedTab === id}>
              <Component />
            </TabContent>
          );
        })}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: CopilotPlugin;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => {
  // Add a key state that we'll change when resetting
  const [resetKey, setResetKey] = React.useState(0);
  const { latestVersion, hasUpdate } = useLatestVersion(plugin.manifest.version);

  const handleReset = async () => {
    const modal = new ResetSettingsConfirmModal(app, async () => {
      resetSettings();
      // Increment the key to force re-render of all components
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <TabProvider>
      <div>
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h1 className="tw-flex tw-flex-col tw-sm:flex-row tw-sm:items-center tw-sm:justify-between tw-gap-2">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span>Copilot Settings</span>
              <div className="tw-flex tw-items-center tw-gap-1">
                <span className="tw-text-xs tw-text-muted">v{plugin.manifest.version}</span>
                {latestVersion && (
                  <>
                    {hasUpdate ? (
                      <a
                        href="obsidian://show-plugin?id=copilot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tw-text-xs tw-text-accent tw-hover:underline"
                      >
                        (Update to v{latestVersion})
                      </a>
                    ) : (
                      <span className="tw-text-xs tw-text-normal"> (up to date)</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="tw-self-end tw-sm:self-auto">
              <Button variant="secondary" size="sm" onClick={handleReset}>
                Reset Settings
              </Button>
            </div>
          </h1>
        </div>
        {/* Add the key prop to force re-render */}
        <SettingsContent key={resetKey} plugin={plugin} />
      </div>
    </TabProvider>
  );
};

export default SettingsMainV2;
