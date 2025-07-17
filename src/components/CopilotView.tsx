import ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
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

  // Return an icon for this view
  getIcon(): string {
    return "message-square";
  }

  // Return a title for this view
  getTitle(): string {
    return "Copilot Chat";
  }

  getDisplayText(): string {
    return "Copilot";
  }

  async onOpen(): Promise<void> {
    this.root = createRoot(this.containerEl.children[1]);
    const handleSaveAsNote = (saveFunction: () => Promise<void>) => {
      this.handleSaveAsNote = saveFunction;
    };
    const updateUserMessageHistory = (newMessage: string) => {
      this.plugin.updateUserMessageHistory(newMessage);
    };

    this.renderView(handleSaveAsNote, updateUserMessageHistory);
  }

  private renderView(
    handleSaveAsNote: (saveFunction: () => Promise<void>) => void,
    updateUserMessageHistory: (newMessage: string) => void
  ): void {
    if (!this.root) return;

    this.root.render(
      <AppContext.Provider value={this.app}>
        <EventTargetContext.Provider value={this.eventTarget}>
          <React.StrictMode>
            <Tooltip.Provider delayDuration={0}>
              <Chat
                chainManager={this.chainManager}
                updateUserMessageHistory={updateUserMessageHistory}
                fileParserManager={this.fileParserManager}
                plugin={this.plugin}
                onSaveChat={handleSaveAsNote}
                chatUIState={this.plugin.chatUIState}
              />
            </Tooltip.Provider>
          </React.StrictMode>
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
    // Note: The new architecture handles message loading through ChatManager
    // The messages will be loaded when the Chat component initializes
    const handleSaveAsNote = (saveFunction: () => Promise<void>) => {
      this.handleSaveAsNote = saveFunction;
    };
    const updateUserMessageHistory = (newMessage: string) => {
      this.plugin.updateUserMessageHistory(newMessage);
    };

    this.renderView(handleSaveAsNote, updateUserMessageHistory);
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
