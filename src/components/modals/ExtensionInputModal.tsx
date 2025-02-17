import { App, Modal } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ExtensionInputModalContent({
  onConfirm,
  onCancel,
}: {
  onConfirm: (extension: string) => void;
  onCancel: () => void;
}) {
  // TODO: Add validation
  const [extension, setExtension] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Enter the extension (e.g. txt, excalidraw)"
        value={extension}
        onChange={(e) => setExtension(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={() => onConfirm(extension)}>
          Confirm
        </Button>
      </div>
    </div>
  );
}

export class ExtensionInputModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onConfirm: (extension: string) => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Add Extension");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = (extension: string) => {
      this.onConfirm(extension);
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <ExtensionInputModalContent onConfirm={handleConfirm} onCancel={handleCancel} />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
