import { App, Modal } from "obsidian";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import React, { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { getModelDisplayText } from "@/components/ui/model-display";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { logError } from "@/logger";
import { CustomPromptSyntaxInstruction } from "@/components/CustomPromptSyntaxInstruction";
import { CustomCommand } from "@/commands/type";
import { validateCommandName } from "@/commands/customCommandUtils";

type FormErrors = {
  title?: string;
  content?: string;
};

function CustomCommandSettingsModalContent({
  commands,
  command: initialCommand,
  onConfirm,
  onCancel,
}: {
  commands: CustomCommand[];
  command: CustomCommand;
  onConfirm: (command: CustomCommand) => void;
  onCancel: () => void;
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

  const handleUpdate = (field: keyof CustomCommand, value: any) => {
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

    const nameError = validateCommandName(command.title, commands, initialCommand.title);
    if (nameError) {
      newErrors.title = nameError;
    }

    if (!command.content.trim()) {
      newErrors.content = "Prompt is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onConfirm(command);
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="title">Name</Label>
        <Input
          id="title"
          value={command.title}
          onChange={(e) => handleUpdate("title", e.target.value)}
          placeholder="Enter command name"
        />
        {errors.title && <div className="tw-text-sm tw-text-error">{errors.title}</div>}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="content">Prompt</Label>
        <CustomPromptSyntaxInstruction />
        <Textarea
          id="content"
          value={command.content}
          onChange={(e) => handleUpdate("content", e.target.value)}
          placeholder="Enter command prompt"
          className="tw-min-h-[200px]"
        />
        {errors.content && <div className="tw-text-sm tw-text-error">{errors.content}</div>}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="modelKey">Model (Optional)</Label>
        <div className="tw-group tw-relative tw-w-full">
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
              "tw-w-full tw-appearance-none",
              "tw-flex tw-h-9 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-pr-8",
              "tw-text-sm !tw-shadow tw-transition-colors",
              "focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring",
              "disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
              "hover:tw-bg-interactive-hover hover:tw-text-normal"
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
              "tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-pr-2",
              "tw-transition-colors group-hover:[&>svg]:tw-text-normal"
            )}
          >
            <ChevronDown className="tw-size-4" />
          </div>
        </div>
      </div>

      <div className="tw-flex tw-items-center tw-gap-2">
        <Checkbox
          id="showInContextMenu"
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => handleUpdate("showInContextMenu", checked)}
        />
        <Label htmlFor="showInContextMenu">Show in context menu</Label>
      </div>

      <div className="tw-flex tw-items-center tw-gap-2">
        <Checkbox
          id="showInSlashMenu"
          checked={command.showInSlashMenu}
          onCheckedChange={(checked) => handleUpdate("showInSlashMenu", checked)}
        />
        <Label htmlFor="showInSlashMenu">Show in slash menu</Label>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2">
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

export class CustomCommandSettingsModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private commands: CustomCommand[],
    private command: CustomCommand,
    private onUpdate: (command: CustomCommand) => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Edit Command");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = (command: CustomCommand) => {
      this.onUpdate(command);
      this.close();
    };

    this.root.render(
      <CustomCommandSettingsModalContent
        commands={this.commands}
        command={this.command}
        onConfirm={handleConfirm}
        onCancel={() => this.close()}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
