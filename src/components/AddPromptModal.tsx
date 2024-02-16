import { App, Modal, Notice } from "obsidian";


export class AddPromptModal extends Modal {
  constructor(
    app: App,
    onSave: (title: string, prompt: string) => void,
    initialTitle = '',
    initialPrompt = '',
    disabledTitle?: boolean,
  ) {
    super(app);

    this.contentEl.createEl('h2', { text: 'User Custom Prompt' });

    const formContainer = this.contentEl.createEl('div', { cls: 'copilot-command-modal' });

    const titleContainer = formContainer.createEl(
      'div',
      { cls: 'copilot-command-input-container' }
    );

    titleContainer.createEl(
      'h3', { text: 'Title', cls: 'copilot-command-header' }
    );
    titleContainer.createEl(
      'p',
      {
        text: 'The title of the prompt, must be unique.',
        cls: 'copilot-command-input-description',
      }
    );

    const titleField = titleContainer.createEl('input', { type: 'text' });
    if (disabledTitle) {
      titleField.setAttribute('disabled', 'true');
    }
    if (initialTitle) {
      titleField.value = initialTitle;
    }

    const promptContainer = formContainer.createEl(
      'div',
      { cls: 'copilot-command-input-container' }
    );

    promptContainer.createEl(
      'h3', { text: 'Prompt', cls: 'copilot-command-header' }
    );

    const promptDescFragment = createFragment((frag) => {
      frag.createEl(
        'strong',
        { text: '- {} represents the selected text (not required). ' }
      );
      frag.createEl('br');
      frag.createEl(
        'strong',
        { text: '- {[[Note Title]]} represents a note. ' }
      );
      frag.createEl('br');
      frag.createEl(
        'strong',
        { text: '- {FolderPath} represents a folder of notes. ' }
      );
      frag.createEl('br');
      frag.createEl(
        'strong',
        { text: '- {#tag1, #tag2} represents ALL notes with ANY of the specified tags in their property. ' }
      );
      frag.createEl('br');
      frag.createEl('br');
      frag.appendText('Tip: turn on debug mode to show the processed prompt in the chat window.');
      frag.createEl('br');
      frag.createEl('br');
    });
    promptContainer.appendChild(promptDescFragment);

    const promptField = promptContainer.createEl('textarea');
    if (initialPrompt) {
      promptField.value = initialPrompt;
    }

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
      cls: 'copilot-command-input-description',
    });

    descContainer.appendChild(descFragment);

    const saveButtonContainer = formContainer.createEl(
      'div',
      { cls: 'copilot-command-save-btn-container' }
    );
    const saveButton = saveButtonContainer.createEl(
      'button',
      { text: 'Save', cls: 'copilot-command-save-btn' }
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
