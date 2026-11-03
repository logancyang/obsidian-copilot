import { openNavigatorWhenPreviewActivates } from "@/agentMode/navigator/openSessionsSidebar";
import { NavigatorBlockedNotice } from "@/agentMode/navigator/ui/NavigatorUpsell";
import { SessionsSidebar } from "@/agentMode/navigator/ui/SessionsSidebar";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { useIsPreviewEnabled } from "@/plusUtils";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";

interface PreviewSessionsSidebarProps extends React.ComponentProps<typeof SessionsSidebar> {
  onClose: () => void;
}

function PreviewSessionsSidebar({ onClose, ...props }: PreviewSessionsSidebarProps) {
  // Unknown preview access (undefined) keeps the list, so a Supporter's Navigator never flashes the notice at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/819
  const blocked = useIsPreviewEnabled() === false;
  React.useEffect(() => {
    if (blocked) openNavigatorWhenPreviewActivates(props.plugin);
  }, [blocked, props.plugin]);
  return blocked ? <NavigatorBlockedNotice onClose={onClose} /> : <SessionsSidebar {...props} />;
}

export default class SessionsSidebarView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SESSIONS_SIDEBAR_VIEWTYPE;
  }

  getIcon(): string {
    return "panel-left";
  }

  getDisplayText(): string {
    return "Copilot Navigator";
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
  }

  private renderTree(): React.ReactNode {
    const manager = this.plugin.agentSessionManager;
    return manager ? (
      <PreviewSessionsSidebar
        manager={manager}
        plugin={this.plugin}
        onClose={() => this.leaf.detach()}
      />
    ) : null;
  }

  async onClose(): Promise<void> {
    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}
