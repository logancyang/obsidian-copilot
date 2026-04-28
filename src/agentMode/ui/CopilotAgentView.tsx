import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { attachChatViewLayoutObservers } from "@/components/chat-components/attachChatViewLayoutObservers";
import { ChatViewLayout } from "@/components/chat-components/ChatViewLayout";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

export default class CopilotAgentView extends ItemView {
  private root: Root | null = null;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  private layout: ChatViewLayout | null = null;
  private disposeLayoutObservers: (() => void) | null = null;
  eventTarget: EventTarget;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
    this.app = plugin.app;
    this.eventTarget = new EventTarget();
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_AGENT_VIEWTYPE;
  }

  getIcon(): string {
    return "bot";
  }

  getTitle(): string {
    return "Copilot Agent Chat";
  }

  getDisplayText(): string {
    return "Copilot Agent";
  }

  async onOpen(): Promise<void> {
    this.root = createRoot(this.containerEl.children[1]);
    this.renderChat();
    this.layout = new ChatViewLayout(this.containerEl, this.app.workspace);

    const observers = attachChatViewLayoutObservers(this.containerEl);
    this.disposeLayoutObservers = observers.dispose;

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        requestAnimationFrame(() => observers.rebindDrawerObserver());
      })
    );
  }

  private renderChat(): void {
    if (!this.root) return;

    this.root.render(
      <AppContext.Provider value={this.app}>
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
      </AppContext.Provider>
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
