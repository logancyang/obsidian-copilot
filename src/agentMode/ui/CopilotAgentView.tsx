import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { attachChatViewLayoutObservers } from "@/components/chat-components/attachChatViewLayoutObservers";
import { CHAT_AGENT_VIEWTYPE, COPILOT_AGENT_ICON_ID } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";

export default class CopilotAgentView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  private disposeLayoutObservers: (() => void) | null = null;
  eventTarget: ChatViewEventTarget;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
    this.app = plugin.app;
    this.eventTarget = new ChatViewEventTarget();
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_AGENT_VIEWTYPE;
  }

  getIcon(): string {
    return COPILOT_AGENT_ICON_ID;
  }

  getTitle(): string {
    return "Copilot Agent Chat";
  }

  getDisplayText(): string {
    return "Copilot Agent";
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());

    const observers = attachChatViewLayoutObservers(this.containerEl);
    this.disposeLayoutObservers = observers.dispose;

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        window.requestAnimationFrame(() => observers.rebindDrawerObserver());
      })
    );
  }

  private renderTree(): React.ReactNode {
    return (
      <EventTargetContext.Provider value={this.eventTarget}>
        <Tooltip.Provider delayDuration={0}>
          <AgentModeChat
            plugin={this.plugin}
            onSaveChat={(fn) => {
              this.handleSaveAsNote = fn;
            }}
            updateUserMessageHistory={(msg) => this.plugin.updateUserMessageHistory(msg)}
          />
        </Tooltip.Provider>
      </EventTargetContext.Provider>
    );
  }

  async saveChat(): Promise<void> {
    if (this.handleSaveAsNote) {
      await this.handleSaveAsNote();
    }
  }

  updateView(): void {
    this.viewRoot?.rerender();
  }

  async onClose(): Promise<void> {
    this.disposeLayoutObservers?.();
    this.disposeLayoutObservers = null;

    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}
