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
  updateShouldAbort(abortController);
  try {
    // TODO: Need to run certain models without langchain
    // it will mean no retrieval qa mode for those models!

    await aiState.runChain(
      userMessage.message,
      abortController,
      updateCurrentAiMessage,
      addMessage,
      debug,
    );
  } catch (error) {
    console.error('Model request failed:', error);
    new Notice('Model request failed:', error);
  }
};
