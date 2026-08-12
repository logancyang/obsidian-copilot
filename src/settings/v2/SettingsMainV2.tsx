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
import { Cog, Command, Cpu, ShieldCheck, Sigma, Sparkle, Wrench } from "lucide-react";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { SETTINGS_SEARCH_ANCHOR_ATTR } from "@/lib/settingsSearchAnchor";
import {
  SETTINGS_TAB_IDS,
  subscribeSettingsDeepLink,
  type SettingsTabId,
} from "@/settings/v2/settingsSearch";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { DesktopOnlySettingsPanel } from "./components/DesktopOnlySettingsPanel";
import { MiyoSettings } from "./components/MiyoSettings";
import { SelfHostSettings } from "./components/SelfHostSettings";

// DESIGN NOTE (settings-v4, part 1): there is intentionally no "QA"/"Search"
// tab here. The legacy QASettings panel was removed as orphan-component cleanup
// (see designdocs/SETTINGS_REDESIGN_V4.md and SETTINGS_V4_PR_PLAN.md); the
// underlying fields are NOT dropped and stay runtime-honored for existing
// vaults:
//   - enableSemanticSearchV3 — now driven implicitly by the Miyo connect flow
//     (MiyoSettings), not a manual toggle.
//   - qaInclusions/qaExclusions — still consumed (Miyo registration snapshot);
//     their edit UI is deferred per issue #195 ("defer include/exclude").
//   - embeddingModelKey / maxSourceChunks / enableInlineCitations / indexing
//     limits — still read at runtime (embeddingManager, SearchTools,
//     VaultQAChainRunner, CopilotPlusChainRunner) with their defaults; a
//     UI is deferred to a later part of the #195 redesign.
// The relabeled "Keyword (built-in) vs Miyo (semantic search)" engine toggle
// and honest embedding-caveat copy land in a follow-up PR, not here. If a review
// flags the missing QA/search UI again, point them at this note.
const TAB_IDS = SETTINGS_TAB_IDS;
type TabId = SettingsTabId;

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
const icons: Record<TabId, JSX.Element> = {
  basic: <Cog className="tw-size-5" />,
  byok: <Cpu className="tw-size-5" />,
  miyo: <Sigma className="tw-size-5" />,
  selfhost: <ShieldCheck className="tw-size-5" />,
  command: <Command className="tw-size-5" />,
  skills: <Sparkle className="tw-size-5" />,
  advanced: <Wrench className="tw-size-5" />,
};

// tab components
const components: Record<TabId, React.FC> = {
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
const TAB_LABELS: Record<TabId, string> = {
  basic: "Basic",
  byok: "BYOK",
  miyo: "Miyo",
  selfhost: "Self-Host",
  command: "Command",
  skills: "Skills",
  advanced: "Advanced",
};

// tabs
const tabs: TabItemType[] = TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: TAB_LABELS[id],
}));

/** How long the deep-linked row keeps Obsidian's `is-flashing` highlight. */
const DEEP_LINK_FLASH_MS = 750;

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  const rootRef = React.useRef<HTMLDivElement>(null);
  // The anchor rides in a ref (it must not retrigger renders on its own);
  // the tick is the state that sequences "scroll after the tab committed".
  const pendingAnchorRef = React.useRef<string | null>(null);
  const [deepLinkTick, setDeepLinkTick] = React.useState(0);

  // Settings-search deep links: switch to the mapped tab first, then scroll
  // once that tab's content has committed (the effect below).
  React.useEffect(() => {
    return subscribeSettingsDeepLink((link) => {
      pendingAnchorRef.current = link.anchor;
      setSelectedTab(link.tabId);
      setDeepLinkTick((tick) => tick + 1);
    });
  }, [setSelectedTab]);

  React.useEffect(() => {
    if (deepLinkTick === 0) return;
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!anchor) return;
    const target = rootRef.current?.querySelector<HTMLElement>(
      `[${SETTINGS_SEARCH_ANCHOR_ATTR}="${anchor}"]`
    );
    // Anchors are best-effort: rows hidden behind collapsed or conditional UI
    // may be absent, in which case landing on the tab is the whole deep link.
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    // Obsidian's own settings search flashes its target row via this class;
    // reusing it keeps the highlight native-looking and theme-aware.
    target.classList.add("is-flashing");
    const flashTimeout = window.setTimeout(
      () => target.classList.remove("is-flashing"),
      DEEP_LINK_FLASH_MS
    );
    return () => {
      window.clearTimeout(flashTimeout);
      target.classList.remove("is-flashing");
    };
  }, [deepLinkTick]);

  return (
    <div ref={rootRef} className="tw-flex tw-flex-col">
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
