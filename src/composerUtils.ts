import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { getSystemPrompt } from "@/settings/model";

// Cache for the composer prompt
let cachedComposerPrompt: string | null = null;

/**
 * Reset the cached composer prompt.
 */
export function resetComposerPromptCache(): void {
  cachedComposerPrompt = null;
}

/**
 * Get the system prompt for the composer.
 * This combines the user's system prompt with the composer-specific prompt.
 */
export async function getComposerSystemPrompt(): Promise<string> {
  // Get the current system prompt
  const currentSystemPrompt = getSystemPrompt();

  // If we already have a cached composer prompt, use it
  if (cachedComposerPrompt) {
    return `${currentSystemPrompt}\n${cachedComposerPrompt}`;
  }

  // Otherwise, fetch it from the API
  const brevilabsClient = BrevilabsClient.getInstance();
  try {
    // Get the composer prompt from the API
    const composerPromptResponse = await brevilabsClient.composerPrompt();
    cachedComposerPrompt = composerPromptResponse.prompt;

    // Combine the prompts
    return `${currentSystemPrompt}\n${cachedComposerPrompt}`;
  } catch (error) {
    console.error("Failed to fetch composer prompt:", error);
    // Fallback to just the system prompt if API call fails
    return currentSystemPrompt;
  }
}
