import { App, FuzzySuggestModal } from "obsidian";

interface Language {
  code: string;
  name: string;
}

const LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
];

export class LanguageModal extends FuzzySuggestModal<Language> {
  private onChooseLanguage: (language: string) => void;

  constructor(app: App, onChooseLanguage: (language: string) => void) {
    super(app);
    this.onChooseLanguage = onChooseLanguage;
  }

  getItems(): Language[] {
    return LANGUAGES;
  }

  getItemText(language: Language): string {
    return language.name;
  }

  onChooseItem(language: Language, evt: MouseEvent | KeyboardEvent) {
    this.onChooseLanguage(language.name);
  }
}
