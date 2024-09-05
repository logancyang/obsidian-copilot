import ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { CHAT_VIEWTYPE } from "@/constants";
import { AppContext } from "@/context";
import CopilotPlugin from "@/main";
import { CopilotSettings } from "@/settings/SettingsPage";
import SharedState from "@/sharedState";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root, createRoot } from "react-dom/client";

export default class CopilotView extends ItemView {
  private chainManager: ChainManager;
  private root: Root | null = null;
  private settings: CopilotSettings;
  private defaultSaveFolder: string;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  private debug = false;
  sharedState: SharedState;
  emitter: EventTarget;
  userSystemPrompt = "";

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: CopilotPlugin
  ) {
    super(leaf);
    this.sharedState = plugin.sharedState;
    this.settings = plugin.settings;
    this.app = plugin.app;
    this.chainManager = plugin.chainManager;
    this.debug = plugin.settings.debug;
    this.emitter = new EventTarget();
    this.getChatVisibility = this.getChatVisibility.bind(this);
    this.userSystemPrompt = plugin.settings.userSystemPrompt;
    this.plugin = plugin;
    this.defaultSaveFolder = plugin.settings.defaultSaveFolder;
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

  async getChatVisibility() {
    if (this.plugin.activateViewPromise) {
      await this.plugin.activateViewPromise;
    }
    return this.plugin.isChatVisible();
  }

  async onOpen(): Promise<void> {
    const root = createRoot(this.containerEl.children[1]);
    root.render(
      <AppContext.Provider value={this.app}>
        <React.StrictMode>
          <Chat
            sharedState={this.sharedState}
            settings={this.settings}
            chainManager={this.chainManager}
            emitter={this.emitter}
            getChatVisibility={this.getChatVisibility}
            defaultSaveFolder={this.defaultSaveFolder}
            plugin={this.plugin}
            debug={this.debug}
            onSaveChat={(saveFunction) => {
              this.handleSaveAsNote = saveFunction;
            }}
          />
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
}
