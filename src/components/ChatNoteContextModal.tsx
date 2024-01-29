import { CopilotSettings } from "@/settings/SettingsPage";
import { App, Modal } from "obsidian";

export class ChatNoteContextModal extends Modal {
  private settings: CopilotSettings;
  private onSubmit: (path: string) => void;

  constructor(app: App, settings: CopilotSettings, onSubmit: (path: string) => void) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const formContainer = this.contentEl.createEl('div', { cls: 'copilot-command-modal' });
    const pathContainer = formContainer.createEl('div', { cls: 'copilot-command-input-container' });

    pathContainer.createEl('h3', { text: 'Folder Path', cls: 'copilot-command-header' });
    const descFragment = createFragment((frag) => {
      frag.appendText('All notes under the path will be sent to the prompt when the ');
      frag.createEl(
        'strong',
        { text: 'Send Note(s) to Prompt' }
      );
      frag.appendText(' button is clicked in Chat mode. ');
      frag.appendText('If none provided, ');
      frag.createEl(
        'strong',
        { text: 'default context is the active note' }
      );
    });
    pathContainer.appendChild(descFragment);

    const pathField = pathContainer.createEl(
      'input',
      {
        type: 'text',
        cls: 'copilot-command-input',
        value: this.settings.chatNoteContextPath,
      }
    );
    pathField.setAttribute('name', 'folderPath');

    const submitButtonContainer = formContainer.createEl('div', { cls: 'copilot-command-save-btn-container' });
    const submitButton = submitButtonContainer.createEl('button', { text: 'Submit', cls: 'copilot-command-save-btn' });

    submitButton.addEventListener('click', () => {
      // Remove the leading slash if it exists
      let pathValue = pathField.value;
      if (pathValue.startsWith('/') && pathValue.length > 1) {
        pathValue = pathValue.slice(1);
      }
      this.onSubmit(pathValue);
      this.close();
    });
  }
}