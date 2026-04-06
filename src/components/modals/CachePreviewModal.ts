import { App, Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";

/**
 * Read-only modal for previewing cached parsed file content.
 *
 * Features:
 * - Wider layout (90vw / max 800px) for comfortable reading
 * - Markdown rendering via Obsidian's MarkdownRenderer
 * - Copy icon button with visual feedback (copy → check → copy)
 * - Scrollable content area with theme-aware styling
 */
export class CachePreviewModal extends Modal {
  private component: Component;

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

    // Reason: override default modal width for wider content preview
    modalEl.style.width = "90vw";
    modalEl.style.maxWidth = "800px";

    contentEl.empty();
    contentEl.addClass("tw-flex", "tw-flex-col", "tw-p-0");
    this.component.load();

    // Header: file icon + title + copy button
    const header = contentEl.createDiv({
      cls: "tw-flex tw-items-center tw-justify-between tw-px-5 tw-py-3 tw-border-b tw-border-border",
    });

    const titleWrapper = header.createDiv({
      cls: "tw-flex tw-items-center tw-gap-2 tw-min-w-0",
    });
    const fileIconEl = titleWrapper.createDiv({ cls: "tw-text-muted tw-shrink-0" });
    setIcon(fileIconEl, "file-text");
    titleWrapper.createEl("span", {
      text: this.title,
      cls: "tw-font-semibold tw-text-normal tw-truncate",
    });

    // Copy button with icon feedback
    const copyBtn = header.createEl("button", {
      cls: "tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-rounded-md tw-bg-secondary tw-border-none tw-cursor-pointer tw-text-muted hover:tw-text-normal tw-shrink-0",
      attr: { "aria-label": "Copy content", title: "Copy content" },
    });
    const copyIconEl = copyBtn.createSpan({ cls: "tw-flex tw-items-center" });
    setIcon(copyIconEl, "copy");

    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.content).then(
        () => {
          // Reason: visual feedback — icon changes to check mark for 2 seconds
          setIcon(copyIconEl, "check");
          copyBtn.addClass("tw-text-accent");
          new Notice("Copied to clipboard");
          setTimeout(() => {
            setIcon(copyIconEl, "copy");
            copyBtn.removeClass("tw-text-accent");
          }, 2000);
        },
        () => new Notice("Failed to copy")
      );
    });

    // Content area: scrollable rendered markdown
    const scrollArea = contentEl.createDiv({
      cls: "tw-overflow-auto tw-p-5",
      attr: { style: "max-height: 50vh" },
    });

    const mdContainer = scrollArea.createDiv({
      cls: "markdown-rendered tw-p-4 tw-bg-primary-alt tw-rounded-lg tw-border tw-border-border",
    });

    // Reason: pass empty sourcePath to prevent vault link resolution
    MarkdownRenderer.renderMarkdown(this.content, mdContainer, "", this.component);
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}
