import { useCallback, useMemo } from "react";
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
      addedVia: "reference",
    } as NoteReference;

    const key = getNoteReferenceKey(noteReference);

    if (!referencesByKey.has(key)) {
      referencesByKey.set(key, noteReference);
    }
  }

  return Array.from(referencesByKey.values());
}

/**
 * React hook that keeps a list of `NoteReference`s in sync with the content of a text input.
 *
 * Behavior:
 * - Parses wiki-links from a provided input string (e.g. `[[Note]]`, `[[Note#Heading]]`, `[[Note#^block]]`).
 * - Resolves each link to a `TFile` using Obsidian's metadata cache.
 * - Builds `NoteReference` objects (with optional `headingRef` or `blockRef`).
 * - Deduplicates by unique key via {@link getNoteReferenceKey}.
 * - Applies a stable sort using {@link getNoteReferenceDisplayText} with `mainNoteIdentifier = "path"`.
 * - Updates the provided `setNoteReferences` only if the ordered keys differ from the current state.
 *
 * Notes:
 * - `currentActiveNote` is used to compute the `sourcePath` for resolving relative links.
 * - `noteReferences` and `inputMessage` are accepted for API symmetry with React usage, but are not
 *   directly read by the synchronizer; callers typically keep them in the dependency list when needed.
 *
 * @param currentActiveNote The currently active note used to derive the `sourcePath` for link resolution.
 * @param noteReferences The current list of note references (state value) managed by the caller.
 * @param setNoteReferences State setter to update the list of note references.
 * @param inputMessage The current input message content; present for API symmetry.
 * @param app The Obsidian `App` instance used to resolve links.
 * @returns An object with a function `synchronizeInputWithNoteReferences(nextInputValue)` that extracts, sorts, and
 *          synchronizes note references from the provided string, returning the computed list.
 *
 * @example
 * const { synchronizeInputWithNoteReferences } = useSynchronizeInputWithNoteReferences(
 *   activeFile,
 *   contextNotes,
 *   setContextNotes,
 *   inputMessage,
 *   app
 * );
 *
 * // Inside onChange handler
 * synchronizeInputWithNoteReferences(event.target.value);
 */
export function useSynchronizeInputWithNoteReferences(
  currentActiveNote: TFile | null,
  noteReferences: NoteReference[],
  setNoteReferences: (
    updater: NoteReference[] | ((prev: NoteReference[]) => NoteReference[])
  ) => void,
  inputMessage: string,
  app: App
): {
  synchronizeInputWithNoteReferences: (nextInputValue: string) => NoteReference[];
} {
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

      // Sort first to ensure stable order for diffing and for final state
      const sorted = extracted.slice().sort(compareByDisplay);

      // Preserve flags (e.g., hasEmbeddedPDFs, addedVia) from previous state when keys match
      setNoteReferences((prev) => {
        const prevByKey = new Map<string, NoteReference>();

        for (const p of prev) {
          prevByKey.set(getNoteReferenceKey(p), p);
        }

        const merged = sorted.map((curr) => {
          const key = getNoteReferenceKey(curr);
          const existing = prevByKey.get(key);
          if (!existing) {
            return curr;
          }

          // Merge preserving extra flags on the existing reference
          return {
            ...curr,
            hasEmbeddedPDFs: existing.hasEmbeddedPDFs ?? curr.hasEmbeddedPDFs,
            addedVia: existing.addedVia ?? curr.addedVia,
          } as NoteReference;
        });

        // Avoid unnecessary state updates if keys and preserved ordering are identical
        const prevKeys = prev.map(getNoteReferenceKey);
        const nextKeys = merged.map(getNoteReferenceKey);
        const isSame = prev.length === merged.length && prevKeys.every((k, i) => k === nextKeys[i]);
        return isSame ? prev : merged;
      });

      return sorted;
    },
    [app, currentActiveNote, setNoteReferences]
  );

  return useMemo(
    () => ({ synchronizeInputWithNoteReferences }),
    [synchronizeInputWithNoteReferences]
  );
}
