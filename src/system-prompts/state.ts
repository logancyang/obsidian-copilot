import { atom, createStore, useAtom } from "jotai";
import { useAtomValue, useSetAtom } from "jotai";
import { UserSystemPrompt } from "@/system-prompts/type";
import { getSettings, updateSetting } from "@/settings/model";

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
 * React hook to get the selected prompt title
 * @returns Currently selected prompt title
 */
export function useSelectedPromptTitle(): string {
  return useAtomValue(selectedPromptTitleAtom, { store: systemPromptsStore });
}

/**
 * React hook to set the selected prompt title
 * @returns Setter function for selected prompt title
 */
export function useSetSelectedPromptTitle() {
  return useSetAtom(selectedPromptTitleAtom, { store: systemPromptsStore });
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
 * React hook to use disable builtin system prompt state
 * @returns Tuple of [disabled, setDisabled]
 */
export function useDisableBuiltinSystemPrompt() {
  return useAtom(disableBuiltinSystemPromptAtom, { store: systemPromptsStore });
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

// ================================
// PERSISTENT STATE (Settings Integration)
// ================================

/**
 * Get the global default system prompt title from settings
 * @returns The default prompt title (empty string means no custom prompt)
 */
export function getDefaultSystemPromptTitle(): string {
  return getSettings().defaultSystemPromptTitle;
}

/**
 * Set the global default system prompt title (persisted to settings)
 * @param title - The prompt title to set as default
 */
export function setDefaultSystemPromptTitle(title: string): void {
  updateSetting("defaultSystemPromptTitle", title);
}

/**
 * Get the effective system prompt content to use
 * Priority: session (selectedPromptTitleAtom) > global default > ""
 * @returns The prompt content
 */
export function getEffectiveSystemPromptContent(): string {
  const prompts = getCachedSystemPrompts();

  // 1. Check session-level selection first (from atom - temporary)
  const sessionPrompt = getSelectedPromptTitle();
  if (sessionPrompt) {
    const prompt = prompts.find((p) => p.title === sessionPrompt);
    if (prompt) return prompt.content;
  }

  // 2. Check global default (from settings - persistent)
  const defaultPrompt = getDefaultSystemPromptTitle();
  if (defaultPrompt) {
    const prompt = prompts.find((p) => p.title === defaultPrompt);
    if (prompt) return prompt.content;
  }

  // 3. No custom prompt selected
  return "";
}

/**
 * Initialize session prompt from global default on plugin load
 * This ensures ChatSettingsPopover starts with the global default
 */
export function initializeSessionPromptFromDefault(): void {
  const defaultPrompt = getDefaultSystemPromptTitle();
  setSelectedPromptTitle(defaultPrompt);
}

/**
 * Reset all session-level system prompt settings to their defaults
 * This should be called when starting a new chat or loading a chat from history
 */
export function resetSessionSystemPromptSettings(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
}
