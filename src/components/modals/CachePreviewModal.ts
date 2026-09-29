import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { PREVIEW_RENDER_LIMIT, truncateForPreview } from "@/utils/truncateForPreview";
import { App, Component, Modal, Notice, setIcon } from "obsidian";

export class CachePreviewModal extends Modal {
  private component: Component;
  private renderRafId?: number;
  private renderRafWin?: Window;

  constructor(
    app: App,
    private title: string,
    private content: string
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;

    modalEl.addClass("!tw-w-[90vw]", "!tw-max-w-[800px]");

    contentEl.empty();
    contentEl.addClass("tw-flex", "tw-flex-col", "tw-p-0");
    this.component.load();

    const { text: previewText, truncated } = truncateForPreview(this.content);

    const header = contentEl.createDiv({
      cls: "tw-flex tw-items-center tw-justify-between tw-px-5 tw-py-3 tw-border-b tw-border-border",
    });

    const titleWrapper = header.createDiv({
      cls: "tw-flex tw-items-center tw-gap-2 tw-min-w-0",
    });
    const fileIconEl = titleWrapper.createDiv({ cls: "tw-text-muted tw-shrink-0" });
    setIcon(fileIconEl, "file-text");
    titleWrapper.createSpan({
      text: this.title,
      cls: "tw-font-semibold tw-text-normal tw-truncate",
    });

    const copyBtn = header.createEl("button", {
      cls: "tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-rounded-md tw-bg-secondary tw-border-none tw-cursor-pointer tw-text-muted hover:tw-text-normal tw-shrink-0",
      attr: { "aria-label": "Copy content", title: "Copy content" },
    });
    const copyIconEl = copyBtn.createSpan({ cls: "tw-flex tw-items-center" });
    setIcon(copyIconEl, "copy");
    this.bindCopyFullContent(copyBtn, copyIconEl);

    if (truncated) {
      const limitKb = Math.round(PREVIEW_RENDER_LIMIT / 1000);
      contentEl.createDiv({
        text: `Preview shows the first ${limitKb} KB for performance. Use Copy to get the full content.`,
        cls: "tw-px-5 tw-py-2 tw-text-sm tw-text-muted tw-border-b tw-border-border tw-bg-secondary",
      });
    }

    const scrollArea = contentEl.createDiv({
      cls: truncated
        ? "tw-h-[50vh] tw-overflow-auto tw-p-5"
        : "tw-max-h-[50vh] tw-overflow-auto tw-p-5",
    });

    const mdContainer = scrollArea.createDiv({
      cls: "markdown-rendered tw-p-4 tw-bg-primary-alt tw-rounded-lg tw-border tw-border-border",
    });

    if (truncated) {
      const endMarker = scrollArea.createDiv({
        cls: "tw-flex tw-items-center tw-gap-3 tw-pt-6 tw-pb-1",
      });
      endMarker.createDiv({ cls: "tw-flex-grow tw-border-t tw-border-border" });
      const fullCopyBtn = endMarker.createEl("button", {
        cls: "tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-px-4 tw-py-1.5 tw-rounded-full tw-bg-secondary tw-border tw-border-border tw-cursor-pointer tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted hover:tw-text-accent hover:tw-border-accent",
        attr: { "aria-label": "Copy full content", title: "Copy full content" },
      });
      const fullCopyIconEl = fullCopyBtn.createSpan({ cls: "tw-flex tw-items-center" });
      setIcon(fullCopyIconEl, "copy");
      fullCopyBtn.createSpan({ text: "Copy full content" });
      this.bindCopyFullContent(fullCopyBtn, fullCopyIconEl);
      endMarker.createDiv({ cls: "tw-flex-grow tw-border-t tw-border-border" });
    }

    const renderContent = (): void => {
      void renderMarkdown(this.app, previewText, mdContainer, "", this.component).catch(
        (error: unknown) => {
          logWarn("[CachePreviewModal] markdown render failed", error);
        }
      );
    };

    if (truncated) {
      const win = this.contentEl.win ?? window;
      this.renderRafWin = win;
      this.renderRafId = win.requestAnimationFrame(() => {
        this.renderRafId = win.requestAnimationFrame(() => {
          this.renderRafId = undefined;
          renderContent();
        });
      });
    } else {
      renderContent();
    }
  }

  onClose(): void {
    if (this.renderRafId !== undefined) {
      (this.renderRafWin ?? window).cancelAnimationFrame(this.renderRafId);
      this.renderRafId = undefined;
    }
    this.renderRafWin = undefined;
    this.component.unload();
    this.contentEl.empty();
  }

  private bindCopyFullContent(button: HTMLElement, iconEl: HTMLElement): void {
    button.addEventListener("click", () => {
      navigator.clipboard.writeText(this.content).then(
        () => {
          setIcon(iconEl, "check");
          button.addClass("tw-text-accent");
          new Notice("Copied to clipboard");
          (button.win ?? window).setTimeout(() => {
            setIcon(iconEl, "copy");
            button.removeClass("tw-text-accent");
          }, 2000);
        },
        () => new Notice("Failed to copy")
      );
    });
  }
}
