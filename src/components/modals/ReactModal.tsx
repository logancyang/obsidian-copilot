import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import type { ReactElement } from "react";
import { type Root } from "react-dom/client";

/** Shared native-frame reset for dialogs that draw their own full-bleed chrome. */
export const FULL_BLEED_MODAL_CLASS = "copilot-modal-full-bleed";

/**
 * Base class for Obsidian-hosted modals whose body is a React tree. Handles
 * the createRoot / unmount / contentEl.empty boilerplate so subclasses only
 * implement `renderContent(close)`.
 */
export abstract class ReactModal extends Modal {
  private root: Root | null = null;

  /**
   * @param app - Obsidian app the modal belongs to; also supplies the React context every plugin root provides.
   * @param title - Text for Obsidian's native title element. Omit for dialogs that draw their own heading — the native title collapses when empty.
   * @param modalClass - Extra class for the modal frame itself, for stylesheet rules that need to reach the frame rather than its content (e.g. stripping the frame's padding for a full-bleed dialog). Applied in the constructor, so the frame is already styled the first time it is painted.
   */
  constructor(app: App, title?: string, modalClass?: string) {
    super(app);
    if (title) {
      this.titleEl.setText(title);
    }
    if (modalClass) {
      this.modalEl.addClass(modalClass);
    }
  }

  /** Render the React body. `close` triggers `this.close()`. */
  protected abstract renderContent(close: () => void): ReactElement;

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.root = createPluginRoot(contentEl, this.app);
    this.root.render(this.renderContent(() => this.close()));
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

/**
 * React modal base for dialogs that provide their own edge-to-edge header,
 * body, and footer instead of using Obsidian's padded native chrome.
 */
export abstract class FullBleedReactModal extends ReactModal {
  constructor(app: App, title?: string) {
    super(app, title, FULL_BLEED_MODAL_CLASS);
  }
}
