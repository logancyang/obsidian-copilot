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

const contextAtom = atom<SelectedTextContext | null>(null);
const lastSelectionAtom = atom<KeyedSelection | null>(null);
const contextsAtom = atom((get) => {
  const context = get(contextAtom);
  return context ? [context] : NO_CONTEXTS;
});

// Sources re-report an unchanged selection on every click and keystroke, and the store remembers the last one
// across a removed badge or a sent message, so neither brings back a selection the user has not changed. Only
// deselecting where it was made forgets it; nothing selected in another note or page says nothing about it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/797
export function reportSelection(report: SelectionReport): void {
  const last = settingsStore.get(lastSelectionAtom);
  if (!report.context) {
    if (report.location !== last?.location) return;
    settingsStore.set(lastSelectionAtom, null);
    settingsStore.set(contextAtom, null);
  } else if (report.key !== last?.key) {
    attachSelection(report);
  }
}

export function attachSelection(selection: KeyedSelection): void {
  settingsStore.set(lastSelectionAtom, selection);
  settingsStore.set(contextAtom, selection.context);
}

export function dismissSelection(id: string): void {
  if (settingsStore.get(contextAtom)?.id === id) settingsStore.set(contextAtom, null);
}

export function clearSelection(): void {
  settingsStore.set(contextAtom, null);
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
