import { atom, createStore, useAtom } from "jotai";
import { useAtomValue } from "jotai";
import { UserSystemPrompt } from "@/system-prompts/type";

// Create independent store for system prompts (similar to custom commands)
const systemPromptsStore = createStore();

// Define atoms
const systemPromptsAtom = atom<UserSystemPrompt[]>([]);
const selectedPromptTitleAtom = atom<string>("");
const disableBuiltinSystemPromptAtom = atom<boolean>(false);

/**
 * React hook to get all system prompts
 * @returns Array of user system prompts
 */
export function useSystemPrompts(): UserSystemPrompt[] {
  return useAtomValue(systemPromptsAtom, { store: systemPromptsStore });
}

/**
 * React hook to get and set the selected prompt title (useState-like)
 * Use this when you need both read and write in the same component
 * @returns Tuple of [selectedTitle, setSelectedTitle]
 */
export function useSelectedPrompt(): [string, (title: string) => void] {
  return useAtom(selectedPromptTitleAtom, { store: systemPromptsStore });
}

/**
 * Get cached system prompts (non-reactive, for non-React code)
 * @returns Array of user system prompts
 */
export function getCachedSystemPrompts(): UserSystemPrompt[] {
  return systemPromptsStore.get(systemPromptsAtom);
}

/**
 * Get selected prompt title (non-reactive, for non-React code)
 * @returns Currently selected prompt title
 */
export function getSelectedPromptTitle(): string {
  return systemPromptsStore.get(selectedPromptTitleAtom);
}

/**
 * Update all system prompts in the store
 * @param prompts - New array of system prompts
 */
export function updateCachedSystemPrompts(prompts: UserSystemPrompt[]): void {
  systemPromptsStore.set(systemPromptsAtom, prompts);
}

/**
 * Add or update a system prompt
 * @param prompt - System prompt to add or update
 */
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

/**
 * Delete a system prompt by title
 * @param title - Title of the prompt to delete
 */
export function deleteCachedSystemPrompt(title: string): void {
  const prompts = systemPromptsStore.get(systemPromptsAtom);
  systemPromptsStore.set(
    systemPromptsAtom,
    prompts.filter((p) => p.title !== title)
  );
}

/**
 * Set the selected prompt title
 * @param title - Title of the prompt to select
 */
export function setSelectedPromptTitle(title: string): void {
  systemPromptsStore.set(selectedPromptTitleAtom, title);
}

/**
 * Set whether to disable builtin system prompt for current session
 * @param disable - Whether to disable the builtin system prompt
 */
export function setDisableBuiltinSystemPrompt(disable: boolean): void {
  systemPromptsStore.set(disableBuiltinSystemPromptAtom, disable);
}

/**
 * Get whether builtin system prompt is disabled for current session
 * @returns Whether the builtin system prompt is disabled
 */
export function getDisableBuiltinSystemPrompt(): boolean {
  return systemPromptsStore.get(disableBuiltinSystemPromptAtom);
}

/**
 * Subscribe to changes in the session-level system-prompt state: the selected
 * prompt title, the "disable builtin" toggle, and the prompts list (whose
 * contents provide the selected prompt). Returns an unsubscribe
 * function.
 *
 * Used by Agent Mode to recompute its composed system prompt and restart
 * spawn-time backends when the effective prompt changes. This fires on any of
 * those atoms changing — including no-op list reloads — so callers should
 * debounce by comparing the selected prompt content and builtin toggle.
 */
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

/**
 * Pending file writes to prevent infinite loops when modifying files
 */
const pendingFileWrites = new Set<string>();

/**
 * Add a file path to the pending writes set
 */
export function addPendingFileWrite(path: string): void {
  pendingFileWrites.add(path);
}

/**
 * Remove a file path from the pending writes set
 */
export function removePendingFileWrite(path: string): void {
  pendingFileWrites.delete(path);
}

/**
 * Check if a file path is in the pending writes set
 */
export function isPendingFileWrite(path: string): boolean {
  return pendingFileWrites.has(path);
}

/**
 * Reset all session-level system prompt settings to their defaults
 * This should be called when starting a new chat or loading a chat from history
 */
export function resetSessionSystemPromptSettings(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
}
