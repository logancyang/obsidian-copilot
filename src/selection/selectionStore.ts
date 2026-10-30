import { settingsStore } from "@/settings/model";
import type { SelectedTextContext } from "@/types/message";
import { atom, useAtomValue } from "jotai";

export interface SelectionReport {
  location: string;
  key: string;
  context: SelectedTextContext | null;
}

interface SelectionState {
  context: SelectedTextContext | null;
  lastKey: string | null;
}

const NO_CONTEXTS = Object.freeze([]) as unknown as SelectedTextContext[];

const selectionAtom = atom<SelectionState>({ context: null, lastKey: null });
const contextsAtom = atom((get) => {
  const { context } = get(selectionAtom);
  return context ? [context] : NO_CONTEXTS;
});

function update(patch: Partial<SelectionState>): void {
  settingsStore.set(selectionAtom, { ...settingsStore.get(selectionAtom), ...patch });
}

function locationOf(context: SelectedTextContext): string {
  return context.sourceType === "web" ? context.url : context.notePath;
}

// Sources re-report an unchanged selection on every click and keystroke, and the store remembers the last one
// across a removed badge or a sent message, so neither brings back a selection the user has not changed.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/797
export function reportSelection({ location, key, context }: SelectionReport): void {
  const state = settingsStore.get(selectionAtom);
  if (key === state.lastKey) return;
  const clears = !context && state.context !== null && locationOf(state.context) === location;
  update({ context: context ?? (clears ? null : state.context), lastKey: key });
}

export function attachSelection(context: SelectedTextContext): void {
  update({ context });
}

export function dismissSelection(id: string): void {
  if (settingsStore.get(selectionAtom).context?.id === id) update({ context: null });
}

export function clearSelection(): void {
  if (settingsStore.get(selectionAtom).context) update({ context: null });
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
