import { App, FuzzySuggestModal } from "obsidian";


export class ApplyPromptModal extends FuzzySuggestModal<string> {
  private onChoosePromptTitle: (promptTitle: string) => void;
  private promptTitles: string[];

  constructor(
    app: App,
    promptTitles: string[],
    onChoosePromptTitle: (promptTitle: string) => void
  ) {
    super(app);
    this.promptTitles = promptTitles;
    this.onChoosePromptTitle = onChoosePromptTitle;
  }

  getItems(): string[] {
    return this.promptTitles;
  }

  getItemText(promptTitle: string): string {
    return promptTitle;
  }

  onChooseItem(promptTitle: string, evt: MouseEvent | KeyboardEvent) {
    this.onChoosePromptTitle(promptTitle);
  }
}


