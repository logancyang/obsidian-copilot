import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import type { ReactElement } from "react";
import { type Root } from "react-dom/client";

export const FULL_BLEED_MODAL_CLASS = "copilot-modal-full-bleed";

export abstract class ReactModal extends Modal {
  private root: Root | null = null;

  constructor(app: App, title?: string, modalClass?: string) {
    super(app);
    if (title) {
      this.titleEl.setText(title);
    }
    if (modalClass) {
      this.modalEl.addClass(modalClass);
    }
  }

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

export abstract class FullBleedReactModal extends ReactModal {
  constructor(app: App, title?: string) {
    super(app, title, FULL_BLEED_MODAL_CLASS);
  }
}
