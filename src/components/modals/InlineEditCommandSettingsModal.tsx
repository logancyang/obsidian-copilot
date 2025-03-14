import { App, Modal } from "obsidian";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  getModelKeyFromModel,
  InlineEditCommandSettings,
  useSettingsValue,
} from "@/settings/model";
import { validateCommandName } from "@/commands/inlineEditCommandUtils";
import { getModelDisplayText } from "@/components/ui/model-display";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { logError } from "@/logger";

type FormErrors = {
  name?: string;
  prompt?: string;
};

function InlineEditCommandSettingsModalContent({
  command: initialCommand,
  onConfirm,
  onCancel,
  onRemove,
}: {
  command: InlineEditCommandSettings;
  onConfirm: (command: InlineEditCommandSettings) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const settings = useSettingsValue();
  const activeModels = settings.activeModels
    .filter((m) => m.enabled)
    .map((model) => ({
      label: getModelDisplayText(model),
      value: getModelKeyFromModel(model),
    }));
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
      validateCommandName(command.name, initialCommand.name);
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
        <div className="relative w-full group">
          <select
            value={command.modelKey}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) {
                handleUpdate("modelKey", "");
                return;
              }
              const selectedModel = activeModels.find((m) => m.value === value);
              if (!selectedModel) {
                logError(`Model ${value} not found`);
                handleUpdate("modelKey", "");
                return;
              }
              handleUpdate("modelKey", e.target.value);
            }}
            className={cn(
              "w-full appearance-none",
              "flex h-9 rounded-md border border-solid border-border bg-dropdown px-3 py-1 pr-8",
              "text-sm !shadow transition-colors",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "hover:bg-interactive-hover hover:text-normal"
            )}
          >
            <option value="">Inherit from chat model</option>
            {activeModels.map((option) => (
              <option key={option.value} value={option.value.toString()}>
                {option.label}
              </option>
            ))}
          </select>
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2",
              "transition-colors group-hover:[&>svg]:text-normal"
            )}
          >
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="showInContextMenu"
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => handleUpdate("showInContextMenu", checked)}
        />
        <Label htmlFor="showInContextMenu">Show in context menu</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={handleSubmit}>
          Save
        </Button>
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
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
