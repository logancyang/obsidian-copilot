import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { App } from "obsidian";
import { readAgentsFile } from "@/instructions/agentsFile";
import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import { logInfo } from "@/logger";
import {
  getDisableBuiltinSystemPrompt,
  getCachedSystemPrompts,
  getSelectedPromptTitle,
} from "@/system-prompts/state";

/**
 * Resolve Quick Chat instructions for one message, reading vault instructions afresh.
 * @param app - Obsidian app owning the vault whose root instructions apply
 */
export async function getEffectiveUserPrompt(app: App): Promise<string> {
  const selectedTitle = getSelectedPromptTitle();
  const selectedPrompt = getCachedSystemPrompts().find((prompt) => prompt.title === selectedTitle);
  // Explicit session choices override vault instructions, including an empty saved prompt.
  // Hidden legacy defaults must not mask edits to AGENTS.md.
  // https://github.com/logancyang/obsidian-copilot/issues/3210
  return selectedPrompt ? selectedPrompt.content : readAgentsFile(app, "");
}

/**
 * Compose the built-in prompt and a previously resolved instruction snapshot.
 * @param userPrompt - Custom instructions resolved for this message
 */
export function getSystemPrompt(userPrompt: string): string {
  // Check if builtin prompt is disabled for current session
  const disableBuiltin = getDisableBuiltinSystemPrompt();

  if (disableBuiltin) {
    // Only return user custom prompt
    return userPrompt;
  }

  // Default behavior: use builtin prompt
  const basePrompt = DEFAULT_SYSTEM_PROMPT;

  if (userPrompt) {
    return `${basePrompt}
<user_custom_instructions>
${userPrompt}
</user_custom_instructions>`;
  }
  return basePrompt;
}

/**
 * Build system prompt with user memory prefix.
 * Memory content is prepended to the system prompt if available.
 *
 * @param userMemoryManager - Optional memory manager to fetch user memory
 * @param userPrompt - Custom instructions resolved for this message
 * @returns The complete system prompt with memory prefix
 */
export async function getSystemPromptWithMemory(
  userMemoryManager: UserMemoryManager | undefined,
  userPrompt: string
): Promise<string> {
  const systemPrompt = getSystemPrompt(userPrompt);

  if (!userMemoryManager) {
    logInfo("No UserMemoryManager provided to getSystemPromptWithMemory");
    return systemPrompt;
  }
  const memoryPrompt = await userMemoryManager.getUserMemoryPrompt();

  // Only include user_memory section if there's actual memory content
  if (!memoryPrompt) {
    return systemPrompt;
  }

  return `${memoryPrompt}\n${systemPrompt}`;
}
