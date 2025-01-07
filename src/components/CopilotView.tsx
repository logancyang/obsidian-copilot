import ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { CHAT_VIEWTYPE } from "@/constants";
import { AppContext } from "@/context";
import CopilotPlugin from "@/main";
import SharedState from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root, createRoot } from "react-dom/client";

export default class CopilotView extends ItemView {
  private chainManager: ChainManager;
  private fileParserManager: FileParserManager;
  private root: Root | null = null;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  sharedState: SharedState;
  emitter: EventTarget;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
    this.sharedState = plugin.sharedState;
    this.app = plugin.app;
    this.chainManager = plugin.chainManager;
    this.fileParserManager = plugin.fileParserManager;
    this.emitter = new EventTarget();
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
    const root = createRoot(this.containerEl.children[1]);
    const handleSaveAsNote = (saveFunction: () => Promise<void>) => {
      this.handleSaveAsNote = saveFunction;
    };
    const updateUserMessageHistory = (newMessage: string) => {
      this.plugin.updateUserMessageHistory(newMessage);
    };
    root.render(
      <AppContext.Provider value={this.app}>
        <React.StrictMode>
          <Tooltip.Provider delayDuration={0}>
            <Chat
              sharedState={this.sharedState}
              chainManager={this.chainManager}
              emitter={this.emitter}
              updateUserMessageHistory={updateUserMessageHistory}
              fileParserManager={this.fileParserManager}
              plugin={this.plugin}
              onSaveChat={handleSaveAsNote}
            />
          </Tooltip.Provider>
        </React.StrictMode>
      </AppContext.Provider>
    );
  }

  async saveChat(): Promise<void> {
    if (this.handleSaveAsNote) {
      await this.handleSaveAsNote();
    }
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
    }
  }

  updateView(): void {
    // Force a re-render of the React component
    this.onOpen();
  }
}
