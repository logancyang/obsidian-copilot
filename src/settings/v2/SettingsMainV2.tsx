import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { PluginProvider } from "@/contexts/PluginContext";
import { TabProvider, useTab } from "@/contexts/TabContext";
import { useLatestVersion } from "@/hooks/useLatestVersion";
import CopilotPlugin from "@/main";
import { ByokPanel, ModelManagementProvider } from "@/modelManagement";
import { resetSettings } from "@/settings/model";
import { COPILOT_SETTINGS_TAB_IDS, type CopilotSettingsTabId } from "@/settings/settingsTabs";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Cog, Command, Cpu, ShieldCheck, Sigma, Sparkle, Wrench } from "lucide-react";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { DesktopOnlySettingsPanel } from "./components/DesktopOnlySettingsPanel";
import { MiyoSettings } from "./components/MiyoSettings";
import { SelfHostSettings } from "./components/SelfHostSettings";

// DESIGN NOTE (settings-v4, part 1): there is intentionally no "QA"/"Search"
// tab here. The legacy QASettings panel was removed as orphan-component cleanup
// (see designdocs/SETTINGS_REDESIGN_V4.md and SETTINGS_V4_PR_PLAN.md); the
// underlying fields are NOT dropped yet so existing data remains loadable:
//   - qaInclusions/qaExclusions — still consumed as the query-time scope filter
//     over search results; their edit UI is deferred per issue #195
//     ("defer include/exclude").
//   - maxSourceChunks / enableInlineCitations — still read by search and chat.
//     compatibility fields awaiting their dedicated settings migration.
const LazySkillsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.SkillsSettings }))
);

const SkillsSettingsPanel: React.FC = () => {
  // Gate before the dynamic import: on mobile the `@/agentMode` barrel pulls in
  // Node-only modules that throw while being evaluated, so the desktop check
  // has to happen before the import is ever requested.
  if (!isDesktopRuntime()) {
    return <DesktopOnlySettingsPanel message="Skills are available on desktop." />;
  }
  return (
    <React.Suspense fallback={null}>
      <LazySkillsSettings />
    </React.Suspense>
  );
};

// tab icons
const icons: Record<CopilotSettingsTabId, JSX.Element> = {
  basic: <Cog className="tw-size-5" />,
  byok: <Cpu className="tw-size-5" />,
  miyo: <Sigma className="tw-size-5" />,
  selfhost: <ShieldCheck className="tw-size-5" />,
  command: <Command className="tw-size-5" />,
  skills: <Sparkle className="tw-size-5" />,
  advanced: <Wrench className="tw-size-5" />,
};

// tab components
const components: Record<CopilotSettingsTabId, React.FC> = {
  basic: () => <BasicSettings />,
  byok: () => <ByokPanel />,
  miyo: () => <MiyoSettings />,
  selfhost: () => <SelfHostSettings />,
  command: () => <CommandSettings />,
  skills: SkillsSettingsPanel,
  advanced: () => <AdvancedSettings />,
};

// Tab labels — most tabs derive from the id, but a few need a display form the
// id can't produce ("byok" → "BYOK", "selfhost" → "Self-Host").
const TAB_LABELS: Record<CopilotSettingsTabId, string> = {
  basic: "Basic",
  byok: "BYOK",
  miyo: "Miyo",
  selfhost: "Self-Host",
  command: "Command",
  skills: "Skills",
  advanced: "Advanced",
};

// tabs
const tabs = COPILOT_SETTINGS_TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: TAB_LABELS[id],
})) satisfies TabItemType[];

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  const skillLoadErrorCount = useSkillLoadErrorCount();

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-flex tw-flex-wrap tw-rounded-lg">
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.id}
            tab={{
              ...tab,
              // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
              // The tab strip stays mounted while inactive panels do not, so
              // load failures remain visible from every settings section.
              warningLabel:
                tab.id === "skills" && skillLoadErrorCount > 0
                  ? "Some skills failed to load"
                  : undefined,
            }}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
            isFirst={index === 0}
            isLast={index === tabs.length - 1}
          />
        ))}
      </div>
      <div className="tw-w-full tw-border tw-border-solid" />

      <div>
        {COPILOT_SETTINGS_TAB_IDS.map((id) => {
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
  initialTab?: CopilotSettingsTabId;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin, initialTab = "basic" }) => {
  // Add a key state that we'll change when resetting
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
      // Increment the key to force re-render of all components
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <PluginProvider plugin={plugin}>
      <ModelManagementProvider api={plugin.modelManagement}>
        <TabProvider initialTab={initialTab}>
          {/* Obsidian 1.13 made the settings window resizable, and the panel has
              no width of its own — without a cap the rows stretch to whatever
              the user dragged the window to and every control drifts far from
              its label. */}
          <div className="tw-mx-auto tw-max-w-[860px]">
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
