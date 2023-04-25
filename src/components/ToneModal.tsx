import { App, FuzzySuggestModal } from "obsidian";


const TONES: string[] = [
  "Professional",
  "Casual",
  "Straightforward",
  "Confident",
  "Friendly",
];

export class ToneModal extends FuzzySuggestModal<string> {
  private onChooseTone: (tone: string) => void;

  constructor(app: App, onChooseTone: (tone: string) => void) {
    super(app);
    this.onChooseTone = onChooseTone;
  }

  getItems(): string[] {
    return TONES;
  }

  getItemText(tone: string): string {
    return tone;
  }

  onChooseItem(tone: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseTone(tone);
  }
}
