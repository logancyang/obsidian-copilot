import React, { useState, useEffect, useRef } from "react";
import { Notice, MarkdownView } from "obsidian";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { useModelKey } from "@/aiParams";
import { CustomCommand } from "@/commands/type";
import { removeQuickCommandBlocks } from "@/commands/customCommandUtils";
import CopilotPlugin from "@/main";

interface QuickCommandProps {
  plugin: CopilotPlugin;
  onRemove: () => void;
}

export function QuickCommand({ plugin, onRemove }: QuickCommandProps) {
  const [prompt, setPrompt] = useState("");
  const [includeActiveNote, setIncludeActiveNote] = useState(true);
  const [selectedText, setSelectedText] = useState("");
  const [globalModelKey] = useModelKey();
  const [selectedModelKey, setSelectedModelKey] = useState(globalModelKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get the currently selected text from the editor
  useEffect(() => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      const currentSelection = activeView.editor.getSelection();
      setSelectedText(currentSelection);
    }
  }, [plugin.app]);

  // Auto-focus textarea on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      new Notice("Please enter a prompt");
      return;
    }

    const systemPrompt =
      "You are an AI assistant. Follow the user's instructions exactly and provide a direct, focused response. Do not add unnecessary explanations or unrelated content unless specifically requested.";

    let userContent = prompt;
    if (includeActiveNote) {
      userContent += `\n\n{activeNote}`;
    }

    const quickCommand: CustomCommand = {
      title: "Quick Command",
      content: userContent,
      showInContextMenu: false,
      showInSlashMenu: false,
      order: 0,
      modelKey: selectedModelKey,
      lastUsedMs: Date.now(),
    };

    const modal = new CustomCommandChatModal(plugin.app, {
      selectedText,
      command: quickCommand,
      systemPrompt,
    });
    modal.open();

    onRemove();
  };

  const handleCancel = () => {
    onRemove();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-4"
      onKeyDown={handleKeyDown}
    >
      <div className="tw-space-y-4">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your command..."
          className="tw-min-h-24 tw-resize-none"
          rows={3}
        />

        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-flex tw-items-center tw-gap-4">
            <ModelSelector
              size="sm"
              variant="ghost"
              value={selectedModelKey}
              onChange={setSelectedModelKey}
            />

            <div className="tw-flex tw-items-center tw-gap-2">
              <Checkbox
                id="includeActiveNote"
                checked={includeActiveNote}
                onCheckedChange={(checked) => setIncludeActiveNote(!!checked)}
              />
              <label
                htmlFor="includeActiveNote"
                className="tw-cursor-pointer tw-text-sm tw-text-muted"
              >
                Include note context
              </label>
            </div>
          </div>

          <div className="tw-flex tw-items-center tw-gap-2">
            <Button variant="secondary" onClick={handleCancel} size="sm">
              Cancel
            </Button>
            <Button onClick={handleSubmit} size="sm">
              Submit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface QuickCommandContainerProps {
  plugin: CopilotPlugin;
  element: HTMLElement;
}

export function createQuickCommandContainer({ plugin, element }: QuickCommandContainerProps) {
  const container = document.createElement("div");
  element.appendChild(container);

  const root = createRoot(container);

  const handleRemove = () => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      removeQuickCommandBlocks(activeView.editor);
    }

    root.unmount();
    container.remove();
  };

  root.render(<QuickCommand plugin={plugin} onRemove={handleRemove} />);

  return { root, container };
}
