import type { App } from "obsidian";

// Closes the way Obsidian's Modal does: close button and background call close(); Esc goes through onEscapeKey().
// https://github.com/Brevilabs/obsidian-copilot-private/issues/939
export class FakeObsidianModal {
  readonly containerEl: HTMLElement;
  readonly bgEl: HTMLElement;
  readonly modalEl: HTMLElement;
  readonly closeButtonEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  isOpen = false;

  constructor(readonly app: App) {
    this.containerEl = createDiv();
    this.bgEl = this.containerEl.appendChild(createDiv());
    this.modalEl = this.containerEl.appendChild(createDiv());
    this.closeButtonEl = this.modalEl.appendChild(createDiv());
    this.titleEl = this.modalEl.appendChild(createDiv());
    this.contentEl = this.modalEl.appendChild(createDiv());
    this.bgEl.addEventListener("click", () => this.close());
    this.closeButtonEl.addEventListener("click", () => this.close());
  }

  open(): void {
    document.body.appendChild(this.containerEl);
    this.isOpen = true;
    void this.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.containerEl.remove();
    this.onClose();
  }

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
  }

  onOpen(): Promise<void> | void {}

  onClose(): void {}

  onEscapeKey(evt: KeyboardEvent): void {
    if (evt.defaultPrevented) return;
    evt.preventDefault();
    this.close();
  }

  pressEscape(): KeyboardEvent {
    const evt = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    this.onEscapeKey(evt);
    return evt;
  }
}
