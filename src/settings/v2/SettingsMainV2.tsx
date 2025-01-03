import React from "react";
import { Cog, Cpu, Wrench } from "lucide-react";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import BasicSettings from "./components/BasicSettings";
import ModelSettings from "./components/ModelSettings";
import AdvancedSettings from "./components/AdvancedSettings";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { resetSettings } from "@/settings/model";
import CopilotPlugin from "@/main";

const TAB_IDS = ["basic", "model", "advanced"] as const;
type TabId = (typeof TAB_IDS)[number];

// 图标映射
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="w-5 h-5" />,
  model: <Cpu className="w-5 h-5" />,
  advanced: <Wrench className="w-5 h-5" />,
};

// 组件映射
const components = (plugin: CopilotPlugin): Record<TabId, React.FC> => ({
  basic: () => (
    <BasicSettings
      indexVaultToVectorStore={plugin.vectorStoreManager.indexVaultToVectorStore.bind(
        plugin.vectorStoreManager
      )}
    />
  ),
  model: () => (
    <ModelSettings
      indexVaultToVectorStore={plugin.vectorStoreManager.indexVaultToVectorStore.bind(
        plugin.vectorStoreManager
      )}
    />
  ),
  advanced: AdvancedSettings,
});

// tabs 配置
const tabs: TabItemType[] = TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: id.charAt(0).toUpperCase() + id.slice(1),
}));

const SettingsContent: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  const { selectedTab, setSelectedTab } = useTab();

  return (
    <div className="flex flex-col">
      <div className="inline-flex bg-primary rounded-lg">
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

      <div className="bg-background">
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
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            Copilot Settings <small>v{plugin.manifest.version}</small>
          </div>
          <button onClick={() => new ResetSettingsConfirmModal(app, () => resetSettings()).open()}>
            Reset to Default Settings
          </button>
        </h1>
      </div>
      <SettingsContent plugin={plugin} />
    </div>
  </TabProvider>
);

export default SettingsMainV2;
