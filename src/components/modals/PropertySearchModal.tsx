import { getPropertyPattern, shouldIndexFile } from "@/search/searchUtils";
import { getPropertyValuesFromNote } from "@/utils";
import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * Whether a frontmatter key can be offered in the property picker. Excluded
 * because selecting them would misbehave:
 * - empty key: `"": value` is valid YAML, but `[:value]` has no key segment
 *   (the grammar requires one), so it would be reclassified as a folder and
 *   never match.
 * - `position`: Obsidian's FrontMatterCache extends CacheItem, so every
 *   frontmatter object carries a `position` key holding the block's parse
 *   location — parser metadata, not a user property.
 * - keys containing ":", "[" or "]": the `[key:value]` pattern grammar splits on
 *   the first ":" and forbids brackets in the key, so such a key (valid but rare
 *   YAML, e.g. "a:b") would be silently misparsed into the wrong key. Omitting it
 *   is safer than offering it and then never matching the note it came from.
 */
function isSelectablePropertyKey(key: string): boolean {
  // key === key.trim(): parsePropertyPattern trims the key, so a key with leading
  // or trailing whitespace would be stored trimmed and then never match the note.
  return key.length > 0 && key !== "position" && key === key.trim() && !/[:[\]]/.test(key);
}

/**
 * The notes a property pattern can ever match. Both picker steps enumerate from
 * this set so the offered keys and values agree with what the materializer will
 * later resolve: it filters candidates through the same {@link shouldIndexFile}
 * contract, which drops Copilot's own roots (active and historical) and internal
 * files. Scanning every markdown file instead would offer frontmatter that only
 * exists in, say, a saved chat — a selectable source that then matches no note.
 */
function selectablePropertyNotes(app: App): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => shouldIndexFile(app, file, null, null));
}

/**
 * Collect every distinct, selectable frontmatter property key across the vault's
 * markdown notes, sorted. Enumerating real keys (instead of letting the user type
 * one) is what makes the property source dependable: a mistyped key silently
 * matches nothing, which is the failure mode this source exists to avoid.
 */
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

/**
 * Whether a trimmed property value can be offered in the value picker. The input
 * is already normalized with `trim()` to mirror how the matcher compares values
 * ({@link matchFilePathWithProperties} trims both sides), so what the picker
 * offers is exactly what will match. Two kinds are still rejected because they
 * cannot round-trip through the `[key:value]` grammar:
 * - empty (after trim): `getPropertyPattern(key, "")` yields the key-only `[key:]`
 *   form, so offering it would silently flip "equals this value" into "matches any
 *   value".
 * - containing a line terminator: the grammar is single-line (its regex `.`
 *   matches none of \r \n \u2028 \u2029), so such a value would be reclassified as
 *   a folder pattern and match nothing.
 */
function isRepresentablePropertyValue(trimmedValue: string): boolean {
  return trimmedValue.length > 0 && !/[\r\n\u2028\u2029]/.test(trimmedValue);
}

/**
 * Collect the distinct values a given key takes across the vault, sorted. List
 * (array) properties contribute each element, via {@link getPropertyValuesFromNote}.
 * Values are trimmed to match the matcher's comparison, so e.g. a YAML block
 * scalar's trailing newline never hides an otherwise-selectable value.
 */
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

/** A value choice in step two. `null` is the any-value option → key-only pattern. */
type PropertyValueChoice = string | null;

/**
 * Step two of {@link PropertySearchModal}: pick a value for the already-chosen
 * key, or the any-value option to match any note that has the key. Opened as a
 * fresh modal by the key picker so its input and placeholder reset cleanly.
 * Exported so the value step's item list and pattern building can be tested in
 * isolation from the key step that normally precedes it.
 */
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
    // Reason: lead with the any-value option so key-only inclusion is one keystroke away.
    return [null, ...collectPropertyValues(this.app, this.key)];
  }

  getItemText(choice: PropertyValueChoice): string {
    // Reason: the sentinel's label must not collide with a real value. A note whose
    // frontmatter literally holds "(any value)" would otherwise render an entry
    // identical to this option while producing the far narrower `[key:(any value)]`.
    return choice === null ? "Any value — notes that declare this key" : choice;
  }

  onChooseItem(choice: PropertyValueChoice): void {
    this.onChoose(getPropertyPattern(this.key, choice ?? undefined));
  }
}

/**
 * Two-step picker for the Project "Property" (frontmatter) context source. Step
 * one lists every frontmatter key in the vault; choosing one opens a second
 * picker of that key's values (plus an any-value option that yields the
 * key-only pattern). Both steps select from real vault data — never free-typed —
 * so the resulting `[key:value]` pattern always matches at least the note it came
 * from. The finished pattern is delivered through the `onChoose` callback.
 */
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
    // Chain to the value step in a fresh modal — this one closes as the value
    // picker opens, sidestepping the re-open ordering hazard of a single
    // stateful modal (Obsidian closes the modal right after onChooseItem).
    new PropertyValueModal(this.app, key, this.onChoose).open();
  }
}
