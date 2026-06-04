import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { attachChatViewLayoutObservers } from "@/components/chat-components/attachChatViewLayoutObservers";
import { ChatViewLayout } from "@/components/chat-components/ChatViewLayout";
import { CHAT_AGENT_VIEWTYPE, COPILOT_AGENT_ICON_ID } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root } from "react-dom/client";

export default class CopilotAgentView extends ItemView {
  private root: Root | null = null;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  private layout: ChatViewLayout | null = null;
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
    this.root = createPluginRoot(this.containerEl.children[1], this.app);
    this.renderChat();
    this.layout = new ChatViewLayout(this.containerEl, this.app.workspace);

    const observers = attachChatViewLayoutObservers(this.containerEl);
    this.disposeLayoutObservers = observers.dispose;

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        window.requestAnimationFrame(() => observers.rebindDrawerObserver());
      })
    );
  }

  private renderChat(): void {
    if (!this.root) return;

    this.root.render(
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
    this.renderChat();
  }

  async onClose(): Promise<void> {
    this.disposeLayoutObservers?.();
    this.disposeLayoutObservers = null;
    this.layout?.destroy();
    this.layout = null;

    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
