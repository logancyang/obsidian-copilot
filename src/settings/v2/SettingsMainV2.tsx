import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { PluginProvider } from "@/contexts/PluginContext";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import CopilotPlugin from "@/main";
import { ByokPanel, ModelManagementProvider } from "@/modelManagement";
import { resetSettings } from "@/settings/model";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Bot, Cog, Command, Cpu, Database, Sparkle, Sparkles, Wrench } from "lucide-react";
import { Platform } from "obsidian";
import React from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { CopilotPlusSettings } from "./components/CopilotPlusSettings";
import { QASettings } from "./components/QASettings";

const TAB_IDS = ["basic", "byok", "agent", "QA", "command", "skills", "plus", "advanced"] as const;
type TabId = (typeof TAB_IDS)[number];

const LazyAgentSettings = React.lazy(() =>
  import("./components/AgentSettings").then((module) => ({ default: module.AgentSettings }))
);
const LazySkillsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.SkillsSettings }))
);

const DesktopOnlySettingsPanel: React.FC = () => (
  <section className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm tw-text-muted">
    Agent settings are available on desktop.
  </section>
);

const AgentSettingsPanel: React.FC = () => {
  if (!Platform.isDesktopApp) return <DesktopOnlySettingsPanel />;
  return (
    <React.Suspense fallback={null}>
      <LazyAgentSettings />
    </React.Suspense>
  );
};

const SkillsSettingsPanel: React.FC = () => {
  if (!Platform.isDesktopApp) return <DesktopOnlySettingsPanel />;
  return (
    <React.Suspense fallback={null}>
      <LazySkillsSettings />
    </React.Suspense>
  );
};

// tab icons
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="tw-size-5" />,
  byok: <Cpu className="tw-size-5" />,
  agent: <Bot className="tw-size-5" />,
  QA: <Database className="tw-size-5" />,
  command: <Command className="tw-size-5" />,
  skills: <Sparkle className="tw-size-5" />,
  plus: <Sparkles className="tw-size-5" />,
  advanced: <Wrench className="tw-size-5" />,
};

// tab components
const components: Record<TabId, React.FC> = {
  basic: () => <BasicSettings />,
  byok: () => <ByokPanel />,
  agent: AgentSettingsPanel,
  QA: () => <QASettings />,
  command: () => <CommandSettings />,
  skills: SkillsSettingsPanel,
  plus: () => <CopilotPlusSettings />,
  advanced: () => <AdvancedSettings />,
};

// Tab labels — most tabs derive from the id, but "agent" capitalizes to a
// human-friendly label.
const TAB_LABELS: Record<TabId, string> = {
  basic: "Basic",
  byok: "BYOK",
  agent: "Agents",
  QA: "QA",
  command: "Command",
  skills: "Skills",
  plus: "Plus",
  advanced: "Advanced",
};

// tabs
const tabs: TabItemType[] = TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: TAB_LABELS[id],
}));

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-flex tw-flex-wrap tw-rounded-lg">
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
      <div className="tw-w-full tw-border tw-border-solid" />

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

  const handleReset = () => {
    const modal = new ResetSettingsConfirmModal(plugin.app, () => {
      resetSettings();
      // Increment the key to force re-render of all components
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <PluginProvider plugin={plugin}>
      <ModelManagementProvider api={plugin.modelManagement}>
        <TabProvider>
          <div>
            <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
              {/* Reason: Obsidian's settings modal CSS hides plugin-rendered <h1>
                elements (display: none) because Obsidian reserves the top-level
                heading for itself. Use a div with heading-equivalent styling. */}
              <div
                role="heading"
                aria-level={1}
                className="tw-flex tw-flex-col tw-gap-2 tw-text-base tw-font-semibold sm:tw-flex-row sm:tw-items-center sm:tw-justify-between"
              >
                <div className="tw-flex tw-items-center tw-gap-2">
                  <span>Copilot Settings</span>
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
                    Reset Settings
                  </Button>
                </div>
              </div>
            </div>
            {/* Add the key prop to force re-render */}
            <SettingsContent key={resetKey} />
          </div>
        </TabProvider>
      </ModelManagementProvider>
    </PluginProvider>
  );
};

export default SettingsMainV2;
