import { App, Modal, Setting } from "obsidian";
import { CLAUDE_INSTALL_COMMAND } from "./descriptor";

/**
 * Onboarding modal shown when the `claude` CLI cannot be located. Tells
 * the user the exact install command and offers a "Re-detect" button (the
 * resolver runs each time the descriptor's `getInstallState` is queried).
 */
export class ClaudeInstallModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Install Claude CLI" });
    contentEl.createEl("p", {
      text:
        "The Claude (SDK) backend requires the official `claude` CLI installed on your system. " +
        "Run this command in a terminal:",
    });
    const code = contentEl.createEl("pre");
    code.createEl("code", { text: CLAUDE_INSTALL_COMMAND });
    contentEl.createEl("p", {
      text:
        "The Claude Agent SDK is bundled with this plugin; the `claude` CLI provides " +
        "authentication and runs the model — that's why you install `@anthropic-ai/claude-code`.",
    });
    contentEl.createEl("p", {
      text:
        "Then return to Obsidian and click 'Re-detect' in Agent Mode advanced settings. " +
        "Authentication is inherited from the CLI's login state — run `claude` once to sign in if " +
        "you haven't already, or set ANTHROPIC_API_KEY in your shell environment.",
    });
    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Close")
        .setCta()
        .onClick(() => this.close())
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
