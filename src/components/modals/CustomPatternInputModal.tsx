import { App, Modal } from "obsidian";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function CustomPatternInputModalContent({
  onConfirm,
  onCancel,
}: {
  onConfirm: (pattern: string) => void;
  onCancel: () => void;
}) {
  // TODO: Add validation
  const [pattern, setPattern] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onConfirm(pattern);
    }
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-col tw-gap-4">
        <div>
          Comma separated list of paths, tags, note titles or file extension e.g. folder1,
          folder1/folder2, #tag1, #tag2, [[note1]], [[note2]], *.jpg, *.excallidraw.md
        </div>
        <Input
          placeholder="Enter the pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={() => onConfirm(pattern)}>
          Confirm
        </Button>
      </div>
    </div>
  );
}

export class CustomPatternInputModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private onConfirm: (pattern: string) => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Add Custom Pattern");
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
      <CustomPatternInputModalContent onConfirm={handleConfirm} onCancel={handleCancel} />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
