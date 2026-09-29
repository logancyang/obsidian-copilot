import { atom, createStore, useAtom } from "jotai";
import { useAtomValue } from "jotai";
import { UserSystemPrompt } from "@/system-prompts/type";

const systemPromptsStore = createStore();

const systemPromptsAtom = atom<UserSystemPrompt[]>([]);
const selectedPromptTitleAtom = atom<string>("");
const disableBuiltinSystemPromptAtom = atom<boolean>(false);

export function useSystemPrompts(): UserSystemPrompt[] {
  return useAtomValue(systemPromptsAtom, { store: systemPromptsStore });
}

export function useSelectedPrompt(): [string, (title: string) => void] {
  return useAtom(selectedPromptTitleAtom, { store: systemPromptsStore });
}

export function getCachedSystemPrompts(): UserSystemPrompt[] {
  return systemPromptsStore.get(systemPromptsAtom);
}

export function getSelectedPromptTitle(): string {
  return systemPromptsStore.get(selectedPromptTitleAtom);
}

export function updateCachedSystemPrompts(prompts: UserSystemPrompt[]): void {
  systemPromptsStore.set(systemPromptsAtom, prompts);
}

export function upsertCachedSystemPrompt(prompt: UserSystemPrompt): void {
  const prompts = systemPromptsStore.get(systemPromptsAtom);
  const existingIndex = prompts.findIndex((p) => p.title === prompt.title);

  if (existingIndex !== -1) {
    const updated = [...prompts];
    updated[existingIndex] = prompt;
    systemPromptsStore.set(systemPromptsAtom, updated);
  } else {
    systemPromptsStore.set(systemPromptsAtom, [...prompts, prompt]);
  }
}

export function deleteCachedSystemPrompt(title: string): void {
  const prompts = systemPromptsStore.get(systemPromptsAtom);
  systemPromptsStore.set(
    systemPromptsAtom,
    prompts.filter((p) => p.title !== title)
  );
}

export function setSelectedPromptTitle(title: string): void {
  systemPromptsStore.set(selectedPromptTitleAtom, title);
}

export function setDisableBuiltinSystemPrompt(disable: boolean): void {
  systemPromptsStore.set(disableBuiltinSystemPromptAtom, disable);
}

export function getDisableBuiltinSystemPrompt(): boolean {
  return systemPromptsStore.get(disableBuiltinSystemPromptAtom);
}

export function subscribeToSystemPromptChange(callback: () => void): () => void {
  const unsubscribers = [
    systemPromptsStore.sub(selectedPromptTitleAtom, callback),
    systemPromptsStore.sub(disableBuiltinSystemPromptAtom, callback),
    systemPromptsStore.sub(systemPromptsAtom, callback),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

const pendingFileWrites = new Set<string>();

export function addPendingFileWrite(path: string): void {
  pendingFileWrites.add(path);
}

export function removePendingFileWrite(path: string): void {
  pendingFileWrites.delete(path);
}

export function isPendingFileWrite(path: string): boolean {
  return pendingFileWrites.has(path);
}

export function resetSessionSystemPromptSettings(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
}
