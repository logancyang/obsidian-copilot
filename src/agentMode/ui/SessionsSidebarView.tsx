import { NavigatorBlockedNotice } from "@/agentMode/ui/NavigatorUpsell";
import { SessionsSidebar } from "@/agentMode/ui/SessionsSidebar";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { useIsPaidUser } from "@/plusUtils";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";

function PlusSessionsSidebar(props: React.ComponentProps<typeof SessionsSidebar>) {
  // Unknown entitlement (undefined) keeps the list, so a Plus user's Navigator never flashes the notice at startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/813
  return useIsPaidUser() === false ? <NavigatorBlockedNotice /> : <SessionsSidebar {...props} />;
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
    return manager ? <PlusSessionsSidebar manager={manager} plugin={this.plugin} /> : null;
  }

  async onClose(): Promise<void> {
    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}
