import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { Cog, Cpu, Database, Wrench } from "lucide-react";
import { requestUrl } from "obsidian";
import React, { useEffect, useState } from "react";
import AdvancedSettings from "./components/AdvancedSettings";
import BasicSettings from "./components/BasicSettings";
import ModelSettings from "./components/ModelSettings";
import QASettings from "./components/QASettings";

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

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin }) => {
  // Add a key state that we'll change when resetting
  const [resetKey, setResetKey] = React.useState(0);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const response = await requestUrl({
          url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest",
          method: "GET",
        });
        const version = response.json.tag_name.replace("v", "");
        setLatestVersion(version);
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };
    checkForUpdates();
  }, []);

  const handleReset = async () => {
    const modal = new ResetSettingsConfirmModal(app, async () => {
      resetSettings();
      // Increment the key to force re-render of all components
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  const isNewerVersionAvailable =
    latestVersion &&
    (() => {
      const latestParts = latestVersion.split(".").map(Number);
      const currentParts = plugin.manifest.version.split(".").map(Number);

      for (let i = 0; i < 3; i++) {
        if (latestParts[i] > currentParts[i]) return true;
        if (latestParts[i] < currentParts[i]) return false;
      }
      return false;
    })();

  return (
    <TabProvider>
      <div>
        <div className="flex flex-col gap-2">
          <h1 className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <span>Copilot Settings</span>
              <span className="text-xs text-muted">
                v{plugin.manifest.version}
                {latestVersion && (
                  <>
                    {isNewerVersionAvailable ? (
                      <span className="text-accent"> (latest: v{latestVersion})</span>
                    ) : (
                      <span className="text-success"> (up to date)</span>
                    )}
                  </>
                )}
              </span>
            </div>
            <div className="self-end sm:self-auto">
              <Button variant="outline" size="sm" onClick={handleReset}>
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
