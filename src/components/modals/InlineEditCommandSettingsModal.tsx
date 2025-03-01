import { App, Modal } from "obsidian";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { InlineEditCommandSettings } from "@/settings/model";
import { validateCommandName } from "@/commands/inlineEditCommandUtils";

type FormErrors = {
  name?: string;
  prompt?: string;
};

function InlineEditCommandSettingsModalContent({
  command: initialCommand,
  onConfirm,
  onCancel,
  onRemove,
  container,
}: {
  command: InlineEditCommandSettings;
  onConfirm: (command: InlineEditCommandSettings) => void;
  onCancel: () => void;
  onRemove?: () => void;
  container: HTMLElement;
}) {
  const [command, setCommand] = useState(initialCommand);
  const [errors, setErrors] = useState<FormErrors>({});

  const handleUpdate = (field: keyof InlineEditCommandSettings, value: any) => {
    setCommand((prev) => ({
      ...prev,
      [field]: value,
    }));
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const handleSubmit = () => {
    const newErrors: FormErrors = {};

    try {
      validateCommandName(command.name);
    } catch (e) {
      newErrors.name = e.message;
    }

    if (!command.prompt.trim()) {
      newErrors.prompt = "Prompt is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onConfirm(command);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={command.name}
          onChange={(e) => handleUpdate("name", e.target.value)}
          placeholder="Enter command name"
        />
        {errors.name && <div className="text-error text-sm">{errors.name}</div>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="prompt">Prompt</Label>
        <div className="text-sm text-muted mb-2">
          Use <code>{"{copilot-selection}"}</code> as a placeholder for the selected text. If not
          included, the selected text will be appended to the prompt.
        </div>
        <Textarea
          id="prompt"
          value={command.prompt}
          onChange={(e) => handleUpdate("prompt", e.target.value)}
          placeholder="Enter command prompt"
          className="min-h-[200px]"
        />
        {errors.prompt && <div className="text-error text-sm">{errors.prompt}</div>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="modelKey">Model (Optional)</Label>
        <Input
          id="modelKey"
          value={command.modelKey || ""}
          onChange={(e) => handleUpdate("modelKey", e.target.value || undefined)}
          placeholder="Enter model key"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="showInContextMenu"
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => handleUpdate("showInContextMenu", checked)}
        />
        <Label htmlFor="showInContextMenu">Show in context menu</Label>
      </div>

      <div className="flex justify-between gap-2">
        {onRemove ? (
          <Button variant="destructive" onClick={onRemove}>
            Remove
          </Button>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleSubmit}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export class InlineEditCommandSettingsModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private command: InlineEditCommandSettings,
    private onUpdate: (command: InlineEditCommandSettings) => void,
    private onRemove?: () => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Edit Command");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = (command: InlineEditCommandSettings) => {
      this.onUpdate(command);
      this.close();
    };

    const handleRemove = () => {
      this.onRemove?.();
      this.close();
    };

    this.root.render(
      <InlineEditCommandSettingsModalContent
        command={this.command}
        onConfirm={handleConfirm}
        onCancel={() => this.close()}
        onRemove={this.onRemove ? handleRemove : undefined}
        container={this.contentEl}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
