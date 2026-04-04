import { getActiveAgent } from "@/custom-agents/state";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { getSettings } from "@/settings/model";
import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import { logInfo } from "@/logger";
import {
  getDisableBuiltinSystemPrompt,
  getEffectiveSystemPromptContent,
} from "@/system-prompts/state";

/**
 * Get the effective user custom prompt with legacy fallback.
 * This is the single source of truth for user prompt content.
 *
 * Priority: file-based (session override > global default) > legacy setting > ""
 *
 * @returns The user custom prompt content
 */
export function getEffectiveUserPrompt(): string {
  const fileBasedUserPrompt = getEffectiveSystemPromptContent();

  // Fallback: if file-based prompts are unavailable (e.g. migration failed to write files),
  // continue honoring the legacy settings field to fulfill the promise in migration error message.
  return fileBasedUserPrompt || getSettings()?.userSystemPrompt || "";
}

/**
 * Build the complete system prompt for the current session.
 * When a custom agent is active, its instructions are injected.
 *
 * Priority: active agent > session override > global default > legacy setting fallback > ""
 *
 * @returns The complete system prompt string
 */
export function getSystemPrompt(): string {
  const userPrompt = getEffectiveUserPrompt();
  const activeAgent = getActiveAgent();

  // Check if builtin prompt is disabled for current session
  const disableBuiltin = getDisableBuiltinSystemPrompt();

  if (disableBuiltin) {
    return userPrompt;
  }

  const basePrompt = DEFAULT_SYSTEM_PROMPT;

  // Inject active agent instructions
  const agentSection = activeAgent
    ? `\n\n<agent_instructions>\nYou are now acting as the "${activeAgent.title}" agent. ${activeAgent.description}\n\n${activeAgent.content}\n</agent_instructions>`
    : "";

  // Add user custom instructions
  const userSection = userPrompt
    ? `\n<user_custom_instructions>\n${userPrompt}\n</user_custom_instructions>`
    : "";

  return basePrompt + agentSection + userSection;
}

/**
 * Build system prompt with user memory prefix.
 * Memory content is prepended to the system prompt if available.
 *
 * @param userMemoryManager - Optional memory manager to fetch user memory
 * @returns The complete system prompt with memory prefix
 */
export async function getSystemPromptWithMemory(
  userMemoryManager: UserMemoryManager | undefined
): Promise<string> {
  const systemPrompt = getSystemPrompt();

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
