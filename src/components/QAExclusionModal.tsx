import { CopilotSettings } from "@/settings/SettingsPage";
import { App, Modal } from "obsidian";

export class QAExclusionModal extends Modal {
  private settings: CopilotSettings;
  private onSubmit: (paths: string) => void;

  constructor(app: App, settings: CopilotSettings, onSubmit: (paths: string) => void) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const formContainer = this.contentEl.createEl('div', { cls: 'copilot-command-modal' });
    const pathContainer = formContainer.createEl('div', { cls: 'copilot-command-input-container' });

    pathContainer.createEl('h3', { text: 'Exclude by Folder Path or Note Title', cls: 'copilot-command-header' });
    const descFragment = createFragment((frag) => {
      frag.appendText('All notes under the paths will be excluded from indexing');
    });
    pathContainer.appendChild(descFragment);

    const pathField = pathContainer.createEl(
      'input',
      {
        type: 'text',
        cls: 'copilot-command-input',
        value: this.settings.qaExclusionPaths,
        placeholder: 'Enter /folderPath, [[note title]] separated by commas',
      }
    );
    pathField.setAttribute('name', 'folderPath');

    const submitButtonContainer = formContainer.createEl('div', { cls: 'copilot-command-save-btn-container' });
    const submitButton = submitButtonContainer.createEl('button', { text: 'Submit', cls: 'copilot-command-save-btn' });

    submitButton.addEventListener('click', () => {
      // Parse the input list
      const pathsValue = pathField.value
        .split(',')
        .map(pathValue => pathValue.trim())
        .filter(pathValue => pathValue !== '')
        .join(',');

      this.onSubmit(pathsValue);
      this.close();
    });
  }
}