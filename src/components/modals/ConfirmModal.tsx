import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

function ConfirmModalContent({
  content,
  onConfirm,
  onCancel,
  confirmButtonText,
  cancelButtonText,
}: {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButtonText: string;
  cancelButtonText: string;
}) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-5">
      <div className="tw-whitespace-pre-wrap">{content}</div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        {cancelButtonText && (
          <Button variant="secondary" onClick={onCancel}>
            {cancelButtonText}
          </Button>
        )}
        {confirmButtonText && (
          <Button variant="default" onClick={onConfirm}>
            {confirmButtonText}
          </Button>
        )}
      </div>
    </div>
  );
}

export class ConfirmModal extends Modal {
  private root: Root;
  private confirmed = false;

  constructor(
    app: App,
    private onConfirm: () => void | Promise<void>,
    private content: string,
    title: string,
    private confirmButtonText: string = "Continue",
    private cancelButtonText: string = "Cancel",
    private onCancel?: () => void | Promise<void>
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(title);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = () => {
      this.confirmed = true;
      const result = this.onConfirm();
      if (result instanceof Promise) {
        result.catch((err) => logError("ConfirmModal onConfirm failed", err));
      }
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <ConfirmModalContent
        content={this.content}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        confirmButtonText={this.confirmButtonText}
        cancelButtonText={this.cancelButtonText}
      />
    );
  }

  onClose() {
    if (!this.confirmed) {
      const result = this.onCancel?.();
      if (result instanceof Promise) {
        result.catch((err) => logError("ConfirmModal onCancel failed", err));
      }
    }
    this.root.unmount();
  }
}
