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

    titleContainer.createEl(
      'h3', { text: 'Title', cls: 'custom-prompt-header' }
    );
    titleContainer.createEl(
      'p',
      {
        text: 'The title of the prompt, must be unique.',
        cls: 'custom-prompt-description',
      }
    );

    const titleField = titleContainer.createEl('input', { type: 'text' });

    const promptContainer = formContainer.createEl(
      'div',
      { cls: 'custom-prompt-input-container' }
    );

    promptContainer.createEl(
      'h3', { text: 'Prompt', cls: 'custom-prompt-header' }
    );
    promptContainer.createEl(
      'p',
      {
        text: 'The content of the prompt. Use "{}" to represent the selected text. For example, "Improve the readability of the following text: {}"',
        cls: 'custom-prompt-description',
      }
    );
    const promptField = promptContainer.createEl('textarea');

    const descFragment = createFragment((frag) => {
      frag.appendText('Save the prompt to the local prompt library. You can then use it with the Copilot command: ');
      frag.createEl(
        'strong',
        { text: 'Apply custom prompt to selection.' }
      );
      frag.createEl('br');
      frag.appendText('Check out the ');
      frag.createEl('a', {
        href: 'https://github.com/f/awesome-chatgpt-prompts',
        text: 'awesome chatGPT prompts',
      }).setAttr('target', '_blank');
      frag.appendText(' for inspiration.');
    });

    const descContainer = promptContainer.createEl('p', {
      cls: 'custom-prompt-description',
    });

    descContainer.appendChild(descFragment);

    const saveButtonContainer = formContainer.createEl(
      'div',
      { cls: 'custom-prompt-save-btn-container' }
    );
    const saveButton = saveButtonContainer.createEl(
      'button',
      { text: 'Save', cls: 'custom-prompt-save-btn' }
    );
    saveButton.addEventListener('click', () => {
      if (titleField.value && promptField.value) {
        onSave(titleField.value, promptField.value);
        this.close();
      } else {
        new Notice('Please fill in both fields: Title and Prompt.');
      }
    });
  }
}
