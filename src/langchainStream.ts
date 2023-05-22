import AIState from '@/aiState';
import { AI_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import { Notice } from 'obsidian';

export type Role = 'assistant' | 'user' | 'system';

export const getAIResponse = async (
  userMessage: ChatMessage,
  aiState: AIState,
  addMessage: (message: ChatMessage) => void,
  updateCurrentAiMessage: (message: string) => void,
  updateShouldAbort: (abortController: AbortController | null) => void,
  debug = false,
) => {
  const abortController = new AbortController();
  let fullAIResponse = '';

  try {
    updateShouldAbort(abortController);

    // TODO: stop signal gives error: "input values have 2 keys, you must specify an input key or pass only 1 key as input". Follow up with LangchainJS.
    await AIState.chain.call({
        input: userMessage.message,
        // signal: abortController.signal,
      },
      [
        {
          handleLLMNewToken: (token) => {
            fullAIResponse += token;
            updateCurrentAiMessage(fullAIResponse);
          }
        }
      ]
    );
  } catch (error) {
    const errorData = error?.response?.data?.error || error;
    const errorCode = errorData?.code || error;
    new Notice(`LangChain error: ${errorCode}`);
    console.error(errorData);
  } finally {
    if (fullAIResponse) {
      addMessage({
        message: fullAIResponse,
        sender: AI_SENDER,
        isVisible: true,
      });
    }
    updateCurrentAiMessage('');

    if (debug) {
      const {
        model, temperature, maxTokens, systemMessage, chatContextTurns
      } = aiState.langChainParams;
      console.log(`*** DEBUG INFO ***\n`
        + `user message: ${userMessage.message}\n`
        + `model: ${model}\n`
        + `temperature: ${temperature}\n`
        + `maxTokens: ${maxTokens}\n`
        + `system message: ${systemMessage}\n`
        + `chat context turns: ${chatContextTurns}\n`
      );
      console.log('conversation memory:', aiState.memory);
    }
  }
};
