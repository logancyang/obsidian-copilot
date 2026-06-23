import {
  AgentDefaultModelSetting,
  InstallBadge,
  listBackendDescriptors,
  McpServersPanel,
  type BackendDescriptor,
  type BackendId,
} from "@/agentMode";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { TruncatedText } from "@/components/TruncatedText";
import { usePlugin } from "@/contexts/PluginContext";
import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import { logError } from "@/logger";
import { setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { formatBinaryPathForDisplay } from "@/utils/binaryPath";
import { MessageCircle } from "lucide-react";
import { Platform } from "obsidian";
import React from "react";
import { ChatModelEnableList } from "./ChatModelEnableList";
import { ConfiguredModelEnableList } from "./ConfiguredModelEnableList";

/**
 * Explicit ordering for backend sub-tabs. Keeps Opencode → Claude → Codex
 * regardless of what `listBackendDescriptors()` returns.
 */
const BACKEND_ORDER: BackendId[] = ["opencode", "claude", "codex"];

/** Synthetic sub-tab id for the (non-backend) Quick Chat model curation. */
const QUICK_CHAT_TAB_ID = "quickchat";

/** Nearest scrollable ancestor, used to keep the tab strip anchored on switch. */
function getScrollableParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Top-level "Agents" settings tab. Owns the global default-backend picker and
 * the MCP server panel, then a sub-tab strip with one panel per backend plus a
 * Quick Chat panel. Each backend panel curates that backend's default model,
 * enabled models, and binary/auth config.
 */
export const AgentSettings: React.FC = () => {
  const settings = useSettingsValue();
  const plugin = usePlugin();
  const [selectedTab, setSelectedTab] = React.useState<string>(BACKEND_ORDER[0]);
  const tabStripRef = React.useRef<HTMLDivElement>(null);
  const pendingAnchorTop = React.useRef<number | null>(null);

  // Panels vary widely in height (opencode's model list is long, Quick Chat is
  // short), so switching to a shorter one clamps the settings scroll and jumps
  // the view. Pin the tab strip to its pre-switch viewport position so only the
  // content below it changes.
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

  if (Platform.isMobile) {
    return (
      <section>
        <div className="tw-mb-3 tw-text-xl tw-font-bold">Agents</div>
        <div className="tw-text-muted">
          Agent Mode is desktop only. Open the desktop app to configure agents.
        </div>
      </section>
    );
  }

  const allDescriptors = listBackendDescriptors();
  const orderedDescriptors = BACKEND_ORDER.map((id) =>
    allDescriptors.find((d) => d.id === id)
  ).filter((d): d is BackendDescriptor => d !== undefined);

  const tabs: TabItemType[] = [
    ...orderedDescriptors.map((d) => ({
      id: d.id,
      icon: <d.Icon className="tw-size-4" />,
      label: d.displayName,
    })),
    { id: QUICK_CHAT_TAB_ID, icon: <MessageCircle className="tw-size-4" />, label: "Quick Chat" },
  ];

  return (
    <section>
      <div className="tw-mb-3 tw-text-xl tw-font-bold">Agents (alpha)</div>
      <div className="tw-space-y-4">
        <SettingItem
          type="select"
          title="Default backend"
          description="Used when you click + to start a new session and for auto-spawn on mount. Selecting a model from the model picker also updates this."
          value={settings.agentMode.activeBackend}
          onChange={(value) =>
            setSettings((cur) => ({ agentMode: { ...cur.agentMode, activeBackend: value } }))
          }
          options={orderedDescriptors.map((d) => ({ label: d.displayName, value: d.id }))}
        />

        <McpServersPanel />

        <div className="tw-flex tw-flex-col">
          <div ref={tabStripRef} className="tw-flex tw-flex-wrap tw-gap-1" role="tablist">
            {tabs.map((tab, index) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isSelected={selectedTab === tab.id}
                onClick={() => handleSelectTab(tab.id)}
                isFirst={index === 0}
                isLast={index === tabs.length - 1}
              />
            ))}
          </div>

          {orderedDescriptors.map((descriptor) => (
            <TabContent
              key={descriptor.id}
              id={descriptor.id}
              isSelected={selectedTab === descriptor.id}
            >
              <BackendPanel descriptor={descriptor} plugin={plugin} />
            </TabContent>
          ))}
          <TabContent id={QUICK_CHAT_TAB_ID} isSelected={selectedTab === QUICK_CHAT_TAB_ID}>
            <QuickChatPanel />
          </TabContent>
        </div>
      </div>
    </section>
  );
};

/**
 * Quick Chat curation panel: which models appear in the (non-agent) chat model
 * picker. Lives under Agents per the model-management design (chat is a
 * first-class curation backend alongside the agents). Models come from the
 * BYOK / Plus registries — chat doesn't own providers.
 */
const QuickChatPanel: React.FC = () => {
  const settings = useSettingsValue();
  const { options: chatModelOptions, resolveSelectionId } = useChatBackendModelOptions();
  const resolvedDefaultModelId = resolveSelectionId(settings.defaultModelKey);
  const hasDefault = resolvedDefaultModelId !== undefined;

  return (
    <div className="tw-space-y-3">
      <div className="tw-flex tw-min-w-0 tw-flex-col">
        <span className="tw-text-base tw-font-semibold">Quick Chat models</span>
        <span className="tw-text-xs tw-text-muted">
          Models shown in the chat model picker. Add providers on the Models (BYOK) tab.
        </span>
      </div>
      <SettingItem
        type="select"
        title="Default model"
        description="The model new chats start with. Pick from your enabled Quick Chat models."
        value={resolvedDefaultModelId ?? "Select Model"}
        onChange={(value) => {
          if (value === "Select Model") return;
          updateSetting("defaultModelKey", value);
        }}
        options={
          hasDefault
            ? chatModelOptions
            : [{ label: "Select Model", value: "Select Model" }, ...chatModelOptions]
        }
        placeholder="Model"
      />
      <ChatModelEnableList />
    </div>
  );
};

/**
 * One per-backend panel: install header, then (when ready) the default-model
 * picker above the model enable list, then the binary/auth config. If the
 * backend is installed but no catalog is cached yet, it kicks a probe so
 * discovery enrolls the reported models, which then populate the list (the
 * list reads the model-management registry, not the probe state).
 */
const BackendPanel: React.FC<{
  descriptor: BackendDescriptor;
  plugin: ReturnType<typeof usePlugin>;
}> = ({ descriptor, plugin }) => {
  const settings = useSettingsValue();
  const Panel = descriptor.SettingsPanel;
  const manager = plugin.agentSessionManager;

  const installState = descriptor.getInstallState(settings);
  const resolvedPath = descriptor.getResolvedBinaryPath?.(settings) ?? null;

  // Probe when ready but uncached — the load-time preload may have skipped this
  // backend (binary installed after plugin start).
  React.useEffect(() => {
    if (!manager) return;
    if (installState.kind !== "ready") return;
    if (manager.getCachedBackendState(descriptor.id)?.model) return;
    manager
      .preloadModels(descriptor.id)
      .catch((e) => logError(`[AgentMode] preload ${descriptor.id} failed`, e));
  }, [manager, descriptor.id, installState.kind]);

  const Icon = descriptor.Icon;

  return (
    <div className="tw-space-y-3">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <Icon className="tw-size-4 tw-shrink-0" />
          <div className="tw-flex tw-min-w-0 tw-flex-col">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-base tw-font-semibold">{descriptor.displayName}</span>
              <InstallBadge state={installState} />
            </div>
            {resolvedPath && (
              <TruncatedText className="tw-max-w-[90%] tw-font-mono tw-text-xs tw-text-muted">
                {formatBinaryPathForDisplay(resolvedPath)}
              </TruncatedText>
            )}
          </div>
        </div>
        <Button
          className="tw-shrink-0"
          size="default"
          variant={installState.kind === "ready" ? "secondary" : "default"}
          onClick={() => descriptor.openInstallUI(plugin)}
        >
          Configure
        </Button>
      </div>

      {installState.kind === "ready" && manager && (
        <AgentDefaultModelSetting descriptor={descriptor} manager={manager} />
      )}

      {installState.kind === "ready" && <ConfiguredModelEnableList descriptor={descriptor} />}

      {Panel && <Panel plugin={plugin} app={plugin.app} />}
    </div>
  );
};
