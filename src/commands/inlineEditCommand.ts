import { Editor } from "obsidian";
import { InlineEditManager } from "@/components/InlineEditManager";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommand } from "@/commands/type";
import CopilotPlugin from "@/main";

export class InlineEditCommand {
  private plugin: CopilotPlugin;
  private inlineEditManager: InlineEditManager | null = null;

  constructor(plugin: CopilotPlugin) {
    this.plugin = plugin;
  }

  /**
   * Trigger inline edit prompt in the editor
   */
  triggerInlineEdit(editor: Editor) {
    console.log("InlineEditCommand.triggerInlineEdit() called with editor:", editor);

    // Close any existing inline edit
    if (this.inlineEditManager) {
      console.log("Hiding existing inline edit manager");
      this.inlineEditManager.hide();
    }

    // Create new inline edit manager
    console.log("Creating new InlineEditManager");
    this.inlineEditManager = new InlineEditManager(
      editor,
      {
        onSubmit: this.handlePromptSubmit,
        onCancel: this.handlePromptCancel,
      },
      this.plugin.app
    );

    console.log("Calling show() on InlineEditManager");
    this.inlineEditManager.show();
  }

  private handlePromptSubmit = (prompt: string, selectedText: string, editor: Editor) => {
    // Create a temporary custom command with the inline prompt
    const temporaryCommand: CustomCommand = {
      ...EMPTY_COMMAND,
      title: "Inline Edit",
      content: prompt,
    };

    // Open the custom command chat modal directly with the prompt
    const modal = new CustomCommandChatModal(this.plugin.app, {
      selectedText: selectedText,
      command: temporaryCommand,
    });

    modal.open();
  };

  private handlePromptCancel = () => {
    // Just close the inline edit, no additional action needed
  };

  /**
   * Clean up any active inline edit
   */
  cleanup() {
    if (this.inlineEditManager) {
      this.inlineEditManager.hide();
      this.inlineEditManager = null;
    }
  }
}
