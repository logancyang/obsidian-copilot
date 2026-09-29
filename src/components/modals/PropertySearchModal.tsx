import { getPropertyPattern, shouldIndexFile } from "@/search/searchUtils";
import { getPropertyValuesFromNote } from "@/utils";
import { App, FuzzySuggestModal, TFile } from "obsidian";

function isSelectablePropertyKey(key: string): boolean {
  return key.length > 0 && key !== "position" && key === key.trim() && !/[:[\]]/.test(key);
}

function selectablePropertyNotes(app: App): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => shouldIndexFile(app, file, null, null));
}

function collectPropertyKeys(app: App): string[] {
  const keys = new Set<string>();
  for (const file of selectablePropertyNotes(app)) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter) {
      Object.keys(frontmatter).forEach((key) => {
        if (isSelectablePropertyKey(key)) keys.add(key);
      });
    }
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function isRepresentablePropertyValue(trimmedValue: string): boolean {
  return trimmedValue.length > 0 && !/[\r\n\u2028\u2029]/.test(trimmedValue);
}

function collectPropertyValues(app: App, key: string): string[] {
  const values = new Set<string>();
  for (const file of selectablePropertyNotes(app)) {
    getPropertyValuesFromNote(app, file, key).forEach((value) => {
      const normalized = value.trim();
      if (isRepresentablePropertyValue(normalized)) values.add(normalized);
    });
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

type PropertyValueChoice = string | null;

export class PropertyValueModal extends FuzzySuggestModal<PropertyValueChoice> {
  constructor(
    app: App,
    private readonly key: string,
    private readonly onChoose: (pattern: string) => void
  ) {
    super(app);
    this.setPlaceholder(`Select a value for "${key}"`);
  }

  getItems(): PropertyValueChoice[] {
    return [null, ...collectPropertyValues(this.app, this.key)];
  }

  getItemText(choice: PropertyValueChoice): string {
    return choice === null ? "Any value — notes that declare this key" : choice;
  }

  onChooseItem(choice: PropertyValueChoice): void {
    this.onChoose(getPropertyPattern(this.key, choice ?? undefined));
  }
}

export class PropertySearchModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly onChoose: (pattern: string) => void
  ) {
    super(app);
    this.setPlaceholder("Select a property key");
  }

  getItems(): string[] {
    return collectPropertyKeys(this.app);
  }

  getItemText(key: string): string {
    return key;
  }

  onChooseItem(key: string): void {
    new PropertyValueModal(this.app, key, this.onChoose).open();
  }
}
