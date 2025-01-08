import React from "react";
import { Cog, Cpu, Database, Wrench } from "lucide-react";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import BasicSettings from "./components/BasicSettings";
import ModelSettings from "./components/ModelSettings";
import AdvancedSettings from "./components/AdvancedSettings";
import QASettings from "./components/QASettings";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { resetSettings } from "@/settings/model";
import CopilotPlugin from "@/main";
import { Button } from "@/components/ui/button";

const TAB_IDS = ["basic", "model", "QA", "advanced"] as const;
type TabId = (typeof TAB_IDS)[number];

// tab icons
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="w-5 h-5" />,
  model: <Cpu className="w-5 h-5" />,
  QA: <Database className="w-5 h-5" />,
  advanced: <Wrench className="w-5 h-5" />,
};

// tab components
const components = (plugin: CopilotPlugin): Record<TabId, React.FC> => ({
  basic: () => (
    <BasicSettings
      indexVaultToVectorStore={plugin.vectorStoreManager.indexVaultToVectorStore.bind(
        plugin.vectorStoreManager
      )}
    />
  ),
  model: () => <ModelSettings />,
  QA: () => (
    <QASettings
      indexVaultToVectorStore={plugin.vectorStoreManager.indexVaultToVectorStore.bind(
        plugin.vectorStoreManager
      )}
    />
  ),
  advanced: AdvancedSettings,
});

// tabs
const tabs: TabItemType[] = TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: id.charAt(0).toUpperCase() + id.slice(1),
}));

const SettingsContent: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  const { selectedTab, setSelectedTab } = useTab();

  return (
    <div className="flex flex-col">
      <div className="inline-flex rounded-lg">
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
      <div className="w-[100%] border border-solid" />

      <div>
        {TAB_IDS.map((id) => {
          const Component = components(plugin)[id];
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

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => (
  <TabProvider>
    <div>
      <div className="flex flex-col gap-2">
        <h1 className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            Copilot Settings <span className="text-xs">v{plugin.manifest.version}</span>
          </div>
          <div className="self-end sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => new ResetSettingsConfirmModal(app, () => resetSettings()).open()}
            >
              Reset Settings
            </Button>
          </div>
        </h1>
      </div>
      <SettingsContent plugin={plugin} />
    </div>
  </TabProvider>
);

export default SettingsMainV2;
