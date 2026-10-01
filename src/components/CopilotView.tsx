import ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { CHAT_VIEWTYPE } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { registerActiveLeafChangeBridge } from "@/utils/registerActiveLeafChangeBridge";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, Platform, WorkspaceLeaf } from "obsidian";
import * as React from "react";

export default class CopilotView extends ItemView {
  private get chainManager(): ChainManager {
    return this.plugin.chainOwner.getCurrentChainManager();
  }

  private viewRoot: PluginViewRootHandle | null = null;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  private drawerHideObserver: MutationObserver | null = null;
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
    return CHAT_VIEWTYPE;
  }

  getIcon(): string {
    return "message-square";
  }

  getTitle(): string {
    return "Copilot Chat";
  }

  getDisplayText(): string {
    return "Copilot (Quick Chat)";
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());
    this.setupDrawerHideObserver();

    registerActiveLeafChangeBridge(this, this.eventTarget);

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        window.requestAnimationFrame(() => this.setupDrawerHideObserver());
      })
    );
  }

  private setupDrawerHideObserver(): void {
    if (!Platform.isMobile) return;

    this.drawerHideObserver?.disconnect();

    const drawer = this.containerEl.closest<HTMLElement>(".workspace-drawer");
    if (!drawer) return;

    let wasHidden = drawer.classList.contains("is-hidden");

    this.drawerHideObserver = new MutationObserver(() => {
      const isHidden = drawer.classList.contains("is-hidden");
      if (isHidden && !wasHidden) {
        this.containerEl.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
        );
      }
      wasHidden = isHidden;
    });

    this.drawerHideObserver.observe(drawer, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  private setSaveHandler = (saveFunction: () => Promise<void>): void => {
    this.handleSaveAsNote = saveFunction;
  };

  private handleUpdateUserMessageHistory = (newMessage: string): void => {
    this.plugin.updateUserMessageHistory(newMessage);
  };

  private renderTree(): React.ReactNode {
    return (
      <EventTargetContext.Provider value={this.eventTarget}>
        <Tooltip.Provider delayDuration={0}>
          <Chat
            chainManager={this.chainManager}
            updateUserMessageHistory={this.handleUpdateUserMessageHistory}
            plugin={this.plugin}
            onSaveChat={this.setSaveHandler}
            chatUIState={this.plugin.chatUIState}
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
    this.drawerHideObserver?.disconnect();
    this.drawerHideObserver = null;

    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}
