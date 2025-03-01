import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { TabProvider, useTab } from "@/contexts/TabContext";
import CopilotPlugin from "@/main";
import { resetSettings } from "@/settings/model";
import { checkLatestVersion, isNewerVersion } from "@/utils";
import { Cog, Command, Cpu, Database, Wrench } from "lucide-react";
import React, { useEffect, useState } from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { ModelSettings } from "./components/ModelSettings";
import { QASettings } from "./components/QASettings";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";

const TAB_IDS = ["basic", "model", "QA", "command", "advanced"] as const;
type TabId = (typeof TAB_IDS)[number];

// tab icons
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="w-5 h-5" />,
  model: <Cpu className="w-5 h-5" />,
  QA: <Database className="w-5 h-5" />,
  command: <Command className="w-5 h-5" />,
  advanced: <Wrench className="w-5 h-5" />,
};

// tab components
const components: Record<TabId, React.FC> = {
  basic: () => <BasicSettings />,
  model: () => <ModelSettings />,
  QA: () => <QASettings />,
  command: () => <CommandSettings />,
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
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // Check version when settings tab is opened
    const checkForUpdates = async () => {
      const { version, error } = await checkLatestVersion();
      if (error) {
        console.error("Version check failed:", error);
        setUpdateError(error);
      } else if (version) {
        setLatestVersion(version);
        setUpdateError(null);
      }
    };

    checkForUpdates();
  }, [plugin.manifest.version]); // Only re-run if plugin version changes

  const handleReset = async () => {
    const modal = new ResetSettingsConfirmModal(app, async () => {
      resetSettings();
      // Increment the key to force re-render of all components
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  const isNewerVersionAvailable =
    latestVersion && isNewerVersion(latestVersion, plugin.manifest.version);

  return (
    <TabProvider>
      <div>
        <div className="flex flex-col gap-2">
          <h1 className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <span>Copilot Settings</span>
              <span className="text-xs text-muted">
                v{plugin.manifest.version}
                {updateError ? (
                  <span className="text-error" title={updateError}>
                    {" "}
                    (update check failed)
                  </span>
                ) : (
                  latestVersion && (
                    <>
                      {isNewerVersionAvailable ? (
                        <span className="text-accent" title="A new version is available">
                          {" "}
                          (latest: v{latestVersion})
                        </span>
                      ) : (
                        <span className="text-accent"> (up to date)</span>
                      )}
                    </>
                  )
                )}
              </span>
            </div>
            <div className="self-end sm:self-auto">
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
