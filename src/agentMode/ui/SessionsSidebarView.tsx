import { NavigatorBlockedNotice } from "@/agentMode/ui/NavigatorUpsell";
import { openNavigatorWhenPlusActivates } from "@/agentMode/ui/openSessionsSidebar";
import { SessionsSidebar } from "@/agentMode/ui/SessionsSidebar";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { useIsPaidUser } from "@/plusUtils";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";

interface PlusSessionsSidebarProps extends React.ComponentProps<typeof SessionsSidebar> {
  onClose: () => void;
}

function PlusSessionsSidebar({ onClose, ...props }: PlusSessionsSidebarProps) {
  // Unknown entitlement (undefined) keeps the list, so a Plus user's Navigator never flashes the notice at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/813
  const blocked = useIsPaidUser() === false;
  React.useEffect(() => {
    if (blocked) openNavigatorWhenPlusActivates(props.plugin);
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
      <PlusSessionsSidebar
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
