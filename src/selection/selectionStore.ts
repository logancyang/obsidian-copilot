import { settingsStore } from "@/settings/model";
import type { SelectedTextContext } from "@/types/message";
import { atom, useAtomValue } from "jotai";

export interface KeyedSelection {
  location: string;
  key: string;
  context: SelectedTextContext;
}

export type SelectionReport = KeyedSelection | { location: string; context: null };

const NO_CONTEXTS = Object.freeze([]) as unknown as SelectedTextContext[];

const attachedAtom = atom<KeyedSelection | null>(null);
const contextsAtom = atom((get) => {
  const attached = get(attachedAtom);
  return attached ? [attached.context] : NO_CONTEXTS;
});

// Click-read sources re-report an unchanged selection on every click, so only a different one replaces the
// attached badge; once the badge is sent or removed, the next report of the same selection attaches it again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/842
export function reportSelection(report: SelectionReport): void {
  const attached = settingsStore.get(attachedAtom);
  if (!report.context) {
    // Nothing selected in another note or page says nothing about the attached selection.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/797
    if (report.location === attached?.location) clearSelection();
  } else if (report.key !== attached?.key) {
    attachSelection(report);
  }
}

export function attachSelection(selection: KeyedSelection): void {
  settingsStore.set(attachedAtom, selection);
}

export function dismissSelection(id: string): void {
  if (settingsStore.get(attachedAtom)?.context.id === id) clearSelection();
}

export function clearSelection(): void {
  settingsStore.set(attachedAtom, null);
}

export function getSelectedTextContexts(): SelectedTextContext[] {
  return settingsStore.get(contextsAtom);
}

export function useSelectedTextContexts(): SelectedTextContext[] {
  return useAtomValue(contextsAtom, { store: settingsStore });
}

export function subscribeSelection(
  listener: (contexts: SelectedTextContext[]) => void
): () => void {
  return settingsStore.sub(contextsAtom, () => listener(settingsStore.get(contextsAtom)));
}
