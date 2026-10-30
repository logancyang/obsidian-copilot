import { settingsStore } from "@/settings/model";
import type { SelectedTextContext } from "@/types/message";
import { atom, useAtomValue } from "jotai";

export interface SelectionReport {
  location: string;
  key: string;
  context: SelectedTextContext | null;
}

const NO_CONTEXTS = Object.freeze([]) as unknown as SelectedTextContext[];

const contextAtom = atom<SelectedTextContext | null>(null);
const lastKeyAtom = atom<string | null>(null);
const contextsAtom = atom((get) => {
  const context = get(contextAtom);
  return context ? [context] : NO_CONTEXTS;
});

function locationOf(context: SelectedTextContext): string {
  return context.sourceType === "web" ? context.url : context.notePath;
}

// Sources re-report an unchanged selection on every click and keystroke, and the store remembers the last one
// across a removed badge or a sent message, so neither brings back a selection the user has not changed.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/797
export function reportSelection({ location, key, context }: SelectionReport): void {
  if (key === settingsStore.get(lastKeyAtom)) return;
  settingsStore.set(lastKeyAtom, key);
  const attached = settingsStore.get(contextAtom);
  if (context) settingsStore.set(contextAtom, context);
  else if (attached && locationOf(attached) === location) settingsStore.set(contextAtom, null);
}

export function attachSelection(context: SelectedTextContext): void {
  settingsStore.set(contextAtom, context);
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
