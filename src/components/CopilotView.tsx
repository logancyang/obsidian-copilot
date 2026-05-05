import ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { attachChatViewLayoutObservers } from "@/components/chat-components/attachChatViewLayoutObservers";
import { ChatViewLayout } from "@/components/chat-components/ChatViewLayout";
import { CHAT_VIEWTYPE } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { FileParserManager } from "@/tools/FileParserManager";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

export default class CopilotView extends ItemView {
  private get chainManager(): ChainManager {
    return this.plugin.projectManager.getCurrentChainManager();
  }

  private fileParserManager: FileParserManager;
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
    this.fileParserManager = plugin.fileParserManager;
    this.eventTarget = new EventTarget();
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
    return "Copilot";
  }

  async onOpen(): Promise<void> {
    this.root = createRoot(this.containerEl.children[1]);
    this.renderChat();
    this.layout = new ChatViewLayout(this.containerEl, this.app.workspace);

    const observers = attachChatViewLayoutObservers(this.containerEl);
    this.disposeLayoutObservers = observers.dispose;

    // Reason: The view can move between containers (e.g. editor tab → drawer)
    // without onOpen firing again. Re-bind the drawer observer on layout changes
    // so it always watches the correct drawer element. Deferred to next frame
    // so the current observer can catch in-flight class mutations before we rebind.
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
            <Chat
              chainManager={this.chainManager}
              updateUserMessageHistory={(msg) => this.plugin.updateUserMessageHistory(msg)}
              fileParserManager={this.fileParserManager}
              plugin={this.plugin}
              onSaveChat={(fn) => {
                this.handleSaveAsNote = fn;
              }}
              chatUIState={this.plugin.chatUIState}
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
