import { logWarn } from "@/logger";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { PREVIEW_RENDER_LIMIT, truncateForPreview } from "@/utils/truncateForPreview";
import { App, Component, Modal, Notice, setIcon } from "obsidian";

/**
 * Read-only modal for previewing cached parsed file content.
 *
 * Features:
 * - Wider layout (90vw / max 800px) for comfortable reading
 * - Markdown rendering via the project's `renderMarkdown` wrapper
 * - Caps the rendered length (see `truncateForPreview`) so large snapshots
 *   don't freeze the UI; Copy always hands over the full, untruncated content
 * - Copy icon button with visual feedback (copy → check → copy)
 * - Scrollable content area with theme-aware styling
 */
export class CachePreviewModal extends Modal {
  private component: Component;
  /** Pending deferred-render frame, cancelled if the modal closes first. */
  private renderRafId?: number;
  /** The window the frame was scheduled on, so onClose cancels on the same one. */
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

    // Reason: override default modal width for wider content preview
    modalEl.addClass("!tw-w-[90vw]", "!tw-max-w-[800px]");

    contentEl.empty();
    contentEl.addClass("tw-flex", "tw-flex-col", "tw-p-0");
    this.component.load();

    // Reason: cap the synchronous render so large snapshots don't freeze the UI.
    // Copy still hands over the full content below.
    const { text: previewText, truncated } = truncateForPreview(this.content);

    // NOTE: `cls` strings here stay bare (no cn()) to match this file's existing
    // createDiv convention; cn() is for merging conditional JSX classNames, which
    // this imperative DOM construction doesn't need.
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
    this.bindCopyFullContent(copyBtn, copyIconEl);

    // Persistent banner when the preview was capped — keeps it visible above
    // the scroll area instead of buried at the bottom of long content.
    if (truncated) {
      const limitKb = Math.round(PREVIEW_RENDER_LIMIT / 1000);
      contentEl.createDiv({
        text: `Preview shows the first ${limitKb} KB for performance. Use Copy to get the full content.`,
        cls: "tw-px-5 tw-py-2 tw-text-sm tw-text-muted tw-border-b tw-border-border tw-bg-secondary",
      });
    }

    // Content area: scrollable rendered markdown. Truncated content always
    // fills the cap, so pin the height up front — the modal then opens at its
    // final size and the deferred render fills it without growing the window.
    // Small content keeps an auto height so the modal hugs its content.
    const scrollArea = contentEl.createDiv({
      cls: truncated
        ? "tw-h-[50vh] tw-overflow-auto tw-p-5"
        : "tw-max-h-[50vh] tw-overflow-auto tw-p-5",
    });

    const mdContainer = scrollArea.createDiv({
      cls: "markdown-rendered tw-p-4 tw-bg-primary-alt tw-rounded-lg tw-border tw-border-border",
    });

    // Explicit "cut here" marker at the end of the rendered slice so a capped
    // preview reads as truncated, not as the natural end of the content. The
    // flanking divider lines break the body text flow, and the centered pill is
    // an actionable affordance (copy the full content without scrolling back up
    // to the header) — the GitHub "Load diff" / Carbon overflow pattern.
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

    // Reason: pass empty sourcePath to prevent vault link resolution.
    const renderContent = (): void => {
      void renderMarkdown(this.app, previewText, mdContainer, "", this.component).catch(
        (error: unknown) => {
          logWarn("[CachePreviewModal] markdown render failed", error);
        }
      );
    };

    if (truncated) {
      // Defer the heavy render so the (already full-size) shell paints first and
      // the window opens instantly instead of blocking onOpen until the large
      // snapshot is laid out. Two frames: paint the shell, then render.
      //
      // DESIGN NOTE — no "closed" guard around renderContent(): every caller does
      // `new CachePreviewModal(...).open()` (see cacheFileOpener.ts), so an
      // instance is never reused/reopened, and the heavy DOM work is effectively
      // non-interruptible once it starts — the user can't close mid-render. The
      // only residual case (async post-processors finishing after close) writes
      // to a detached, GC-able container with no observable effect. A generation
      // guard would defend a path no caller can reach.
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

  /**
   * Wire a copy-to-clipboard button that always copies the FULL content (never
   * the truncated preview), with icon feedback (copy → check → copy). Shared by
   * the header button and the truncation marker's "Copy full content" pill.
   */
  private bindCopyFullContent(button: HTMLElement, iconEl: HTMLElement): void {
    button.addEventListener("click", () => {
      navigator.clipboard.writeText(this.content).then(
        () => {
          // Reason: visual feedback — icon changes to a check mark for 2 seconds
          setIcon(iconEl, "check");
          button.addClass("tw-text-accent");
          new Notice("Copied to clipboard");
          // Use the button's own window so the reset fires correctly in popouts.
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
