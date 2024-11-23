import { App, FuzzySuggestModal } from "obsidian";

export class ListPromptModal extends FuzzySuggestModal<string> {
  private onChoosePromptTitle: (promptTitle: string) => void;
  private promptTitles: string[];
  private descriptions: string[];

  constructor(
    app: App,
    promptTitles: string[],
    onChoosePromptTitle: (promptTitle: string) => void,
    descriptions: string[] = []
  ) {
    super(app);
    this.promptTitles = promptTitles;
    this.onChoosePromptTitle = onChoosePromptTitle;
    this.descriptions = descriptions;
  }

  getItems(): string[] {
    return this.promptTitles;
  }

  getItemText(promptTitle: string): string {
    const index = this.promptTitles.indexOf(promptTitle);
    const description = this.descriptions[index];
    return description ? `${promptTitle} - ${description}` : promptTitle;
  }

  onChooseItem(promptTitle: string, evt: MouseEvent | KeyboardEvent) {
    const actualTitle = promptTitle.split(" - ")[0];
    this.onChoosePromptTitle(actualTitle);
  }
}
