import { App, Modal, Notice } from "obsidian";


export class AddPromptModal extends Modal {
  constructor(app: App, onSave: (title: string, prompt: string) => void) {
    super(app);

    this.contentEl.createEl('h2', { text: 'Add Custom Prompt' });

    const formContainer = this.contentEl.createEl('div', { cls: 'custom-prompt-modal' });

    const titleContainer = formContainer.createEl(
      'div',
      { cls: 'custom-prompt-input-container' }
    );
    titleContainer.createEl('label', { text: 'Prompt Title' });
    const titleField = titleContainer.createEl('input', { type: 'text' });

    const promptContainer = formContainer.createEl(
      'div',
      { cls: 'custom-prompt-input-container' }
    );
    promptContainer.createEl('label', { text: 'Prompt' });
    const promptField = promptContainer.createEl('textarea');

    const saveButton = formContainer.createEl(
      'button',
      { text: 'Save', cls: 'custom-prompt-save-btn' }
    );
    saveButton.addEventListener('click', () => {
      if (titleField.value && promptField.value) {
        onSave(titleField.value, promptField.value);
        this.close();
      } else {
        new Notice('Please fill in both fields.');
      }
    });
  }
}
