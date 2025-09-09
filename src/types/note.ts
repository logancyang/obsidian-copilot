import { TFile } from "obsidian";

/**
 * A reference to a note, optionally with a heading or block reference.
 */
export type NoteReference = {
  /**
   * The file instance for the note.
   * Path is not included as a prop since it can be derived from the file instance.
   */
  file: TFile;

  /**
   * Optional heading reference for the referenced note.
   * see: https://help.obsidian.md/links#Link+to+a+heading+in+a+note
   * A reference like `[[Obsidian#Links are first-class citizens]]` will have a headingRef of `Links are first-class citizens`.
   */
  headingRef?: string;

  /**
   * Optional block reference for the referenced note.
   * see: https://help.obsidian.md/links#Link%20to%20a%20block%20in%20a%20note
   * A reference like `[[Obsidian^12345678]]` will have a blockRef of `12345678`.
   */
  blockRef?: string;

  /**
   * Whether the RELEVANT content of the note has embedded PDFs.
   * Remarks: replaces the previous flag: hasEmbeddedPDFs that was being assigned to note TFiles.
   */
  hasEmbeddedPDFs?: boolean;

  /**
   * Whether the note was added via a user action or a reference from another note.
   * Remarks: replaces the previous flags: wasAddedViaReference and wasAddedManually that were being assigned to note TFiles.
   */
  addedVia?: "user-action" | "reference";
};
