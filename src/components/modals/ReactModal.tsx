import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import type { ReactElement } from "react";
import { type Root } from "react-dom/client";

/**
 * Base class for Obsidian-hosted modals whose body is a React tree. Handles
 * the createRoot / unmount / contentEl.empty boilerplate so subclasses only
 * implement `renderContent(close)`.
 */
export abstract class ReactModal extends Modal {
  private root: Root | null = null;

  constructor(app: App, title?: string) {
    super(app);
    if (title) {
      this.titleEl.setText(title);
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
