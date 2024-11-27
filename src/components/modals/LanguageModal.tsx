import { App, FuzzySuggestModal } from "obsidian";

interface Language {
  code: string;
  name: string;
}

const LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "el", name: "Greek" },
  { code: "fi", name: "Finnish" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "nl", name: "Dutch" },
  { code: "no", name: "Norwegian" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "vi", name: "Vietnamese" },
  { code: "af", name: "Afrikaans" },
  { code: "bg", name: "Bulgarian" },
  { code: "ca", name: "Catalan" },
  { code: "et", name: "Estonian" },
  { code: "fa", name: "Persian" },
  { code: "fil", name: "Filipino" },
  { code: "hr", name: "Croatian" },
  { code: "is", name: "Icelandic" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "ro", name: "Romanian" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "sr", name: "Serbian" },
  { code: "sw", name: "Swahili" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "ur", name: "Urdu" },
  { code: "zu", name: "Zulu" },
  { code: "mn", name: "Mongolian" },
  { code: "ne", name: "Nepali" },
  { code: "pa", name: "Punjabi" },
  { code: "si", name: "Sinhala" },
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
