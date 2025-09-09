import { NoteReference } from "@/types/note";
import { App, Pos } from "obsidian";

/**
 * Gets the key for a note reference.
 * The key is a string that uniquely identifies a note reference.
 * It is used to cache the note reference content.
 * @param note The note reference to get the key for.
 * @returns The key for the note reference, e.g. `Folder A/Note Path`, `Folder A/Note Path#Heading`, `Folder A/Note Path^Block`
 */
export function getNoteReferenceKey(note: NoteReference): string {
  if (note.headingRef) {
    return `${note.file.path}#${note.headingRef}`;
  }

  if (note.blockRef) {
    return `${note.file.path}^${note.blockRef}`;
  }

  return note.file.path;
}

/**
 * Gets the display text for a note reference.
 * The display text is a string that is used to display the note reference in the UI.
 * It is used to display the note reference in the UI.
 * @param note The note reference to get the display text for.
 * @param includeWikilinkBrackets Whether to include wikilink brackets around the note reference.
 * @param mainNoteIdentifier Whether to use the note name or the note path as the main note identifier.
 * @default "name"
 * @returns The display text for the note reference, e.g. `[[Note Name]]`, `[[Folder A/Note Path]]`, `[[Note Name#Heading]]`, `[[Folder A/Note Path^Block]]`
 */
export function getNoteReferenceDisplayText(
  note: NoteReference,
  includeWikilinkBrackets: boolean = true,
  mainNoteIdentifier: "name" | "path" = "name"
): string {
  const openingBrackets = includeWikilinkBrackets ? "[[" : "";
  const closingBrackets = includeWikilinkBrackets ? "]]" : "";

  const noteName = mainNoteIdentifier === "name" ? note.file.name : note.file.path;

  if (note.headingRef) {
    return `${openingBrackets}${noteName}#${note.headingRef}${closingBrackets}`;
  }

  if (note.blockRef) {
    return `${openingBrackets}${noteName}^${note.blockRef}${closingBrackets}`;
  }

  return `${openingBrackets}${noteName}${closingBrackets}`;
}

/**
 * Gets the relevant note reference content for a given note.
 * Relevant content is defined as:
 * - If a note reference has a heading reference, return the content from the heading start to the start of the next heading of the same level,
 *  or the note end.
 * - If a note reference has a block reference, return the content from the block start to the end of the block reference, including the block reference
 * - Otherwise, return the full note content.
 * @param app The Obsidian app instance.
 * @param note The note reference to get the content for.
 * @returns The relevant note reference content.
 */
export async function getRelevantNoteReferenceContent(
  app: App,
  note: NoteReference
): Promise<string> {
  const fullContents = await app.vault.read(note.file);

  const { headingRef, blockRef } = note;

  if (!headingRef && !blockRef) {
    return fullContents;
  }

  const sliceByPosition = (position?: Pos): string | null => {
    const startOffset = position?.start?.offset;
    const endOffset = position?.end?.offset;

    if (
      typeof startOffset === "number" &&
      typeof endOffset === "number" &&
      startOffset >= 0 &&
      endOffset >= startOffset &&
      endOffset <= fullContents.length
    ) {
      return fullContents.slice(startOffset, endOffset);
    }

    return null;
  };

  const metadataCache = app.metadataCache.getFileCache(note.file);

  if (!metadataCache) {
    return fullContents;
  }

  if (headingRef) {
    const headings = metadataCache.headings;

    if (!headings) {
      return fullContents;
    }

    const heading = headings.find((h) => h.heading.toLowerCase() === headingRef.toLowerCase());

    if (!heading) {
      return fullContents;
    }

    const sliced = sliceByPosition(heading.position);

    return sliced ?? fullContents;
  }

  if (blockRef) {
    const blocks = metadataCache.blocks;

    if (!blocks) {
      return fullContents;
    }

    const block = blocks[blockRef];

    if (!block) {
      return fullContents;
    }

    const sliced = sliceByPosition(block.position);

    return sliced ?? fullContents;
  }

  return fullContents;
}
