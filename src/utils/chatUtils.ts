import { useCallback } from "react";
import { App, TFile, parseLinktext } from "obsidian";
import { NoteReference } from "@/types/note";
import { getNoteReferenceDisplayText, getNoteReferenceKey } from "./noteUtils";

/**
 * Extract all Obsidian wiki links (including headings and block refs) from a text string
 * and resolve them to NoteReference objects.
 * @param text The text to extract note references from.
 * @param sourcePath The path of the source file (most commonly the active note path).
 * @param firstLinkpathDestGetter A function to get the first linkpath destination file (extracted like this for unit testing purposes).
 * Most of the time, it will be: `app.metadataCache.getFirstLinkpathDest`
 * @returns An array of NoteReference objects.
 */
export function extractNoteReferencesFromText(
  text: string,
  sourcePath: string,
  firstLinkpathDestGetter: (linkpath: string, sourcePath: string) => TFile | null
): NoteReference[] {
  if (!text || !firstLinkpathDestGetter) {
    return [];
  }

  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g; // capture inner content of [[...]]

  const referencesByKey = new Map<string, NoteReference>();

  let match: RegExpExecArray | null;

  while ((match = wikiLinkRegex.exec(text)) !== null) {
    const inner = match[1];
    if (!inner) {
      continue;
    }

    // If inner is already bracketed, remove the brackets before passing to parseLinktext.
    let toParse = inner;
    if (inner.startsWith("[[") && inner.endsWith("]]")) {
      toParse = inner.slice(2, -2);
    }

    const { path, subpath } = parseLinktext(toParse);
    if (!path) {
      continue;
    }

    const file: TFile | null = firstLinkpathDestGetter(path, sourcePath);
    if (!file) {
      continue;
    }

    let headingRef: string | undefined;
    let blockRef: string | undefined;

    if (subpath) {
      // subpath starts with '#'
      const withoutHash = subpath.startsWith("#") ? subpath.slice(1) : subpath;

      if (withoutHash.startsWith("^")) {
        blockRef = withoutHash.slice(1);
      } else if (withoutHash.length > 0) {
        headingRef = withoutHash;
      }
    }

    const noteReference = {
      file,
      headingRef,
      blockRef,
    } as NoteReference;

    const key = getNoteReferenceKey(noteReference);

    if (!referencesByKey.has(key)) {
      referencesByKey.set(key, noteReference);
    }
  }

  return Array.from(referencesByKey.values());
}

/**
 * Hook that returns a synchronizer function for aligning input text with extracted note references.
 * For now, it only parses and returns the extracted NoteReference list from the given nextInputValue.
 */
export function useSynchronizeInputWithNoteReferences(
  currentActiveNote: TFile | null,
  noteReferences: NoteReference[],
  setNoteReferences: (
    updater: NoteReference[] | ((prev: NoteReference[]) => NoteReference[])
  ) => void,
  inputMessage: string,
  app: App
) {
  const synchronizeInputWithNoteReferences = useCallback(
    (nextInputValue: string): NoteReference[] => {
      const sourcePath = currentActiveNote?.path ?? "";
      const extracted = extractNoteReferencesFromText(
        nextInputValue,
        sourcePath,
        (path, sourcePath) => app.metadataCache.getFirstLinkpathDest(path, sourcePath)
      );

      // Stable ordering by display text using path as the identifier and no brackets
      const compareByDisplay = (a: NoteReference, b: NoteReference) => {
        const aText = getNoteReferenceDisplayText(a, false, "path").toLowerCase();
        const bText = getNoteReferenceDisplayText(b, false, "path").toLowerCase();
        if (aText < bText) return -1;
        if (aText > bText) return 1;
        return 0;
      };

      const sorted = extracted.slice().sort(compareByDisplay);

      setNoteReferences((prev) => {
        const prevKeys = prev.map(getNoteReferenceKey);
        const nextKeys = sorted.map(getNoteReferenceKey);
        const isSame = prev.length === sorted.length && prevKeys.every((k, i) => k === nextKeys[i]);
        return isSame ? prev : sorted;
      });

      return sorted;
    },
    [app, currentActiveNote, setNoteReferences]
  );

  return synchronizeInputWithNoteReferences;
}
