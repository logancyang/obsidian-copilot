import AIState from '@/aiState';
import { ChatMessage } from '@/sharedState';
import { Notice } from 'obsidian';

export type Role = 'assistant' | 'user' | 'system';

export const getAIResponse = async (
  userMessage: ChatMessage,
  chatContext: ChatMessage[],
  aiState: AIState,
  addMessage: (message: ChatMessage) => void,
  updateCurrentAiMessage: (message: string) => void,
  updateShouldAbort: (abortController: AbortController | null) => void,
  debug = false,
) => {
  const {
    key,
    model,
    temperature,
    maxTokens,
    systemMessage,
    chatContextTurns,
  } = aiState.langChainParams;
  if (!key) {
    new Notice(
      'No OpenAI API key provided. Please set it in Copilot settings, and restart the plugin.'
    );
    return;
  }

  const abortController = new AbortController();

  updateShouldAbort(abortController);
  if (debug) {
    console.log(`*** DEBUG INFO ***\n`
      + `user message: ${userMessage.message}\n`
      + `model: ${model}\n`
      + `temperature: ${temperature}\n`
      + `maxTokens: ${maxTokens}\n`
      + `system message: ${systemMessage}\n`
      + `chat context turns: ${chatContextTurns}\n`,
    );
  }

  await aiState.runChain(
    userMessage.message,
    chatContext,
    abortController,
    updateCurrentAiMessage,
    addMessage,
    debug,
  );
};
