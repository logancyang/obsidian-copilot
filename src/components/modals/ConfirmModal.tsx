import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

function ConfirmModalContent({
  content,
  onConfirm,
  onCancel,
}: {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>{content}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button onClick={onCancel}>Cancel</button>
        <button
          style={{
            backgroundColor: "var(--interactive-accent)",
            color: "var(--text-on-accent)",
            cursor: "pointer",
          }}
          onClick={onConfirm}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export class ConfirmModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onConfirm: () => void,
    private content: string,
    title: string
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
      this.onConfirm();
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
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
