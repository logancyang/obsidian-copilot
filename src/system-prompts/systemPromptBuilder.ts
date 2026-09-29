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

export async function getEffectiveUserPrompt(app: App): Promise<string> {
  const selectedTitle = getSelectedPromptTitle();
  const selectedPrompt = getCachedSystemPrompts().find((prompt) => prompt.title === selectedTitle);
  // Hidden legacy defaults must not mask edits to AGENTS.md.
  // https://github.com/logancyang/obsidian-copilot/issues/3210
  return selectedPrompt ? selectedPrompt.content : readAgentsFile(app, "");
}

export function getSystemPrompt(userPrompt: string): string {
  const disableBuiltin = getDisableBuiltinSystemPrompt();

  if (disableBuiltin) {
    return userPrompt;
  }

  const basePrompt = DEFAULT_SYSTEM_PROMPT;

  if (userPrompt) {
    return `${basePrompt}
<user_custom_instructions>
${userPrompt}
</user_custom_instructions>`;
  }
  return basePrompt;
}

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

  if (!memoryPrompt) {
    return systemPrompt;
  }

  return `${memoryPrompt}\n${systemPrompt}`;
}
