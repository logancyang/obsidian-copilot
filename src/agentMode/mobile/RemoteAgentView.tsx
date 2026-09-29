import { RemoteAgentApp } from "@/agentMode/mobile/RemoteAgentApp";
import { attachChatViewLayoutObservers } from "@/components/chat-components/attachChatViewLayoutObservers";
import { CHAT_AGENT_VIEWTYPE, COPILOT_AGENT_ICON_ID } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import type CopilotPlugin from "@/main";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, type WorkspaceLeaf } from "obsidian";
import * as React from "react";

// The agent chat as a client of a paired desktop. It takes the desktop view's place in the
// workspace on a phone, so a leaf saved from a session that was paired keeps its type.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export class RemoteAgentView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;
  private disposeLayoutObservers: (() => void) | null = null;
  readonly eventTarget = new ChatViewEventTarget();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CopilotPlugin
  ) {
    super(leaf);
    this.app = plugin.app;
  }

  getViewType(): string {
    return CHAT_AGENT_VIEWTYPE;
  }

  getIcon(): string {
    return COPILOT_AGENT_ICON_ID;
  }

  getDisplayText(): string {
    return "Copilot Agent";
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
    const observers = attachChatViewLayoutObservers(this.containerEl);
    this.disposeLayoutObservers = observers.dispose;
    // A layout change can move the view into another drawer, which the observer must follow to
    // dismiss open menus when that drawer closes.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        window.requestAnimationFrame(() => observers.rebindDrawerObserver());
      })
    );
  }

  private renderTree(): React.ReactNode {
    const { remoteClient } = this.plugin;
    if (!remoteClient) return null;
    return (
      <EventTargetContext.Provider value={this.eventTarget}>
        <Tooltip.Provider delayDuration={0}>
          <RemoteAgentApp
            app={this.app}
            remote={remoteClient}
            appVersion={this.plugin.manifest.version}
            updateUserMessageHistory={(message) => this.plugin.updateUserMessageHistory(message)}
          />
        </Tooltip.Provider>
      </EventTargetContext.Provider>
    );
  }

  async onClose(): Promise<void> {
    this.disposeLayoutObservers?.();
    this.disposeLayoutObservers = null;
    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}
