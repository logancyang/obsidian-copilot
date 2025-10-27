import React from "react";
import { Button } from "@/components/ui/button";
import { Copy, Lightbulb, Pencil, Plus, Trash2 } from "lucide-react";
import { App, Modal, Notice, Platform } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { useSettingsValue } from "@/settings/model";
import { Separator } from "@/components/ui/separator";
import { UserSystemPrompt } from "@/system-prompts/type";
import { SystemPromptManager } from "@/system-prompts/systemPromptManager";
import { useSystemPrompts } from "@/system-prompts/state";
import { SystemPromptEditModal } from "@/system-prompts/SystemPromptEditModal";
import { EMPTY_SYSTEM_PROMPT } from "@/system-prompts/constants";
import { logError } from "@/logger";

export function SystemPromptManagerDialogContent() {
  const settings = useSettingsValue();
  const prompts = useSystemPrompts();
  const manager = SystemPromptManager.getInstance();

  /**
   * Open modal to create a new system prompt
   */
  const handleAddPrompt = () => {
    const newPrompt: UserSystemPrompt = {
      ...EMPTY_SYSTEM_PROMPT,
    };
    const modal = new SystemPromptEditModal(app, prompts, newPrompt, async (updatedPrompt) => {
      const now = Date.now();

      const finalPrompt: UserSystemPrompt = {
        ...updatedPrompt,
        createdMs: now,
        modifiedMs: now,
        lastUsedMs: 0,
      };
      await manager.createPrompt(finalPrompt);
    });
    modal.open();
  };

  /**
   * Open modal to edit an existing system prompt
   */
  const handleEditPrompt = (prompt: UserSystemPrompt) => {
    const modal = new SystemPromptEditModal(app, prompts, prompt, async (updatedPrompt) => {
      const now = Date.now();
      const finalPrompt: UserSystemPrompt = {
        ...updatedPrompt,
        modifiedMs: now,
        createdMs: updatedPrompt.createdMs,
        lastUsedMs: updatedPrompt.lastUsedMs,
      };
      await manager.updatePrompt(prompt.title, finalPrompt);
    });
    modal.open();
  };

  /**
   * Delete a system prompt using SystemPromptManager
   */
  const handleDeletePrompt = async (title: string) => {
    try {
      await manager.deletePrompt(title);
      new Notice("System prompt deleted successfully");
    } catch (error) {
      logError("Failed to delete system prompt:", error);
      new Notice("Failed to delete system prompt. Please try again.");
    }
  };

  /**
   * Duplicate a system prompt using SystemPromptManager
   */
  const handleDuplicatePrompt = async (prompt: UserSystemPrompt) => {
    try {
      await manager.duplicatePrompt(prompt);
      new Notice("System prompt duplicated successfully");
    } catch (error) {
      logError("Failed to duplicate system prompt:", error);
      new Notice("Failed to duplicate system prompt. Please try again.");
    }
  };

  const userPrompts = prompts.filter((p) => !p.isBuiltIn);

  return (
    <div className="tw-max-h-[70vh] tw-overflow-y-auto tw-p-4">
      <div className="tw-space-y-4">
        {/* Info and Add Button */}
        <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-muted">
          <Lightbulb className="tw-size-5 tw-shrink-0" />
          <div className="tw-flex-1">
            System prompts are automatically loaded from .md files in your system prompts folder{" "}
            <strong>{settings.userSystemPromptsFolder}</strong>. Modifying the files will also
            update the system prompt settings.
          </div>
        </div>

        <div className="tw-flex tw-justify-end">
          <Button variant="default" className="tw-gap-2" onClick={handleAddPrompt}>
            <Plus className="tw-size-4" />
            Add Prompt
          </Button>
        </div>

        {/* Prompts List */}
        <div className="tw-space-y-3">
          <div className="tw-text-xl tw-font-semibold">Your Prompts</div>
          <Separator />
          <div className="tw-space-y-2">
            {userPrompts.length === 0 ? (
              <div className="tw-rounded-lg tw-border tw-border-border tw-bg-primary tw-p-8 tw-text-center tw-text-muted">
                No custom system prompts found.
              </div>
            ) : (
              userPrompts.map((prompt) => (
                <div
                  key={prompt.title}
                  className="tw-space-y-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-4"
                >
                  <div className="tw-flex tw-items-start tw-justify-between tw-gap-2">
                    <div className="tw-min-w-0 tw-flex-1 tw-truncate">
                      <div className="tw-font-medium">{prompt.title}</div>
                      <div className="tw-mt-1 tw-line-clamp-2 tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-text-muted">
                        {prompt.content}
                      </div>
                    </div>
                    <div className="tw-flex tw-gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDuplicatePrompt(prompt)}
                        title="Duplicate"
                      >
                        <Copy className="tw-size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditPrompt(prompt)}
                        title="Edit"
                      >
                        <Pencil className="tw-size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeletePrompt(prompt.title)}
                        title="Delete"
                      >
                        <Trash2 className="tw-size-4 tw-text-error" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export class SystemPromptManagerModal extends Modal {
  private root: Root;

  constructor(app: App) {
    super(app);
    // @ts-ignore
    this.setTitle("Manage System Prompts");
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    if (Platform.isMobile) {
      modalEl.style.height = "80%";
    }

    this.root = createRoot(contentEl);

    this.root.render(<SystemPromptManagerDialogContent />);
  }

  onClose() {
    this.root.unmount();
  }
}
