import { App, Modal } from 'obsidian';

export class AdhocPromptModal extends Modal {
    result: string;
    onSubmit: (result: string) => void;

    private placeholderText = 'Please enter your custom ad-hoc prompt to process the selection.';

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        const textareaEl = contentEl.createEl('textarea', { attr: { placeholder: this.placeholderText } });
        textareaEl.style.width = '100%';
        textareaEl.style.height = '100px'; // Set the desired height
        textareaEl.style.padding = '10px';
        textareaEl.style.resize = 'vertical'; // Allow vertical resizing

        textareaEl.addEventListener('input', (evt) => {
            this.result = (evt.target as HTMLTextAreaElement).value;
        });

        textareaEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter' && !evt.shiftKey) {
                evt.preventDefault(); // Prevent line break unless Shift key is pressed
                this.close();
                this.onSubmit(this.result);
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
