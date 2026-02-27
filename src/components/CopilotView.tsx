import ChainManager from "@/LLMProviders/chainManager";
import Chat from "@/components/Chat";
import { CHAT_VIEWTYPE } from "@/constants";
import { AppContext, EventTargetContext } from "@/context";
import CopilotPlugin from "@/main";
import { FileParserManager } from "@/tools/FileParserManager";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, Platform, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

export default class CopilotView extends ItemView {
  private get chainManager(): ChainManager {
    return this.plugin.projectManager.getCurrentChainManager();
  }

  private fileParserManager: FileParserManager;
  private root: Root | null = null;
  private handleSaveAsNote: (() => Promise<void>) | null = null;
  private keyboardObserver: MutationObserver | null = null;
  private drawerHideObserver: MutationObserver | null = null;
  private lastDrawerEl: HTMLElement | null = null;
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
    this.setupMobileKeyboardObserver();
    this.setupDrawerHideObserver();

    // Reason: The view can move between containers (e.g. editor tab → drawer)
    // without onOpen firing again. Re-bind the drawer observer on layout changes
    // so it always watches the correct drawer element.
    // Deferred to next frame so the current observer can catch in-flight class mutations
    // before we disconnect and rebind.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        requestAnimationFrame(() => this.setupDrawerHideObserver());
      })
    );
  }

  /**
   * Observe --keyboard-height on <html> style to toggle a class on the
   * parent .workspace-drawer when the soft keyboard is open.
   * CSS uses this class to hide drawer header elements on mobile.
   *
   * Reason: The drawer lookup is inside the callback (not at setup time) because
   * the view can be moved from editor tab to drawer without triggering onOpen again.
   */
  private setupMobileKeyboardObserver(): void {
    if (!Platform.isMobile) return;

    // Reason: Disconnect any existing observer defensively in case onOpen runs more than once
    this.keyboardObserver?.disconnect();

    const syncKeyboardClass = () => {
      const drawer = this.containerEl.closest(".workspace-drawer") as HTMLElement | null;

      // Reason: If the view moved out of its previous drawer, clear the class on the old one
      // so drawer chrome (header/tab options) is restored.
      if (this.lastDrawerEl && this.lastDrawerEl !== drawer) {
        this.lastDrawerEl.classList.remove("copilot-keyboard-open");
      }
      this.lastDrawerEl = drawer;

      if (!drawer) return;

      // Reason: Check if this view itself is inside the active tab content, rather than
      // querying by data-type which is more brittle across Obsidian versions.
      const isCopilotActive = !!this.containerEl.closest(".workspace-drawer-active-tab-content");
      const kbHeight = parseFloat(
        document.documentElement.style.getPropertyValue("--keyboard-height") || "0"
      );
      drawer.classList.toggle("copilot-keyboard-open", isCopilotActive && kbHeight > 0);
    };

    this.keyboardObserver = new MutationObserver(syncKeyboardClass);
    this.keyboardObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });

    // Reason: Sync initial state in case keyboard is already open when view opens
    syncKeyboardClass();
  }

  /**
   * Close any open Radix popovers when the mobile drawer hides.
   *
   * Reason: Radix popovers are portaled to document.body. When the user presses
   * the mobile back button, Obsidian hides the drawer (adds `is-hidden` class)
   * but the popover stays open and jumps to (0,0) because its anchor disappears.
   * Dispatching Escape on the container lets Radix's dismissable-layer close
   * popovers whose triggers live inside this view, without affecting unrelated UI.
   */
  private setupDrawerHideObserver(): void {
    if (!Platform.isMobile) return;

    this.drawerHideObserver?.disconnect();

    const drawer = this.containerEl.closest(".workspace-drawer") as HTMLElement | null;
    if (!drawer) return;

    let wasHidden = drawer.classList.contains("is-hidden");

    this.drawerHideObserver = new MutationObserver(() => {
      const isHidden = drawer.classList.contains("is-hidden");
      if (isHidden && !wasHidden) {
        // Reason: Radix's dismissable-layer listens for Escape in capture phase on
        // document, so this will close the topmost open Radix layer.
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

  private renderView(
    handleSaveAsNote: (saveFunction: () => Promise<void>) => void,
    updateUserMessageHistory: (newMessage: string) => void
  ): void {
    if (!this.root) return;

    this.root.render(
      <AppContext.Provider value={this.app}>
        <EventTargetContext.Provider value={this.eventTarget}>
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
    this.keyboardObserver?.disconnect();
    this.keyboardObserver = null;
    this.drawerHideObserver?.disconnect();
    this.drawerHideObserver = null;
    // Reason: Clean up the class on the tracked drawer element when the view is closed.
    // Use lastDrawerEl instead of querying closest(), because the view may have already
    // been detached from the drawer DOM by the time onClose fires.
    this.lastDrawerEl?.classList.remove("copilot-keyboard-open");
    this.lastDrawerEl = null;

    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
