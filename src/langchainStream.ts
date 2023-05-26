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
  const abortController = new AbortController();

  try {
    updateShouldAbort(abortController);
    if (debug) {
      const {
        model,
        temperature,
        maxTokens,
        systemMessage,
        chatContextTurns,
        embeddingProvider,
      } = aiState.langChainParams;
      console.log(`*** DEBUG INFO ***\n`
        + `user message: ${userMessage.message}\n`
        + `model: ${model}\n`
        + `temperature: ${temperature}\n`
        + `maxTokens: ${maxTokens}\n`
        + `system message: ${systemMessage}\n`
        + `chat context turns: ${chatContextTurns}\n`,
        + `embedding provider: ${embeddingProvider}\n`
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
  } catch (error) {
    const errorData = error?.response?.data?.error || error;
    const errorCode = errorData?.code || error;
    new Notice(`LangChain error: ${errorCode}`);
    console.error(errorData);
  }
};
