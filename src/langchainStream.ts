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
  try {
    let fullAIResponse = '';
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

    addMessage({
      message: fullAIResponse,
      sender: AI_SENDER,
      isVisible: true,
    });
    updateCurrentAiMessage('');

    if (debug) {
      const {
        model, temperature, maxTokens, systemMessage, chatContextTurns
      } = aiState.langChainParams;
      console.log('*** DEBUG INFO ***\n')
      console.log('user message:', userMessage.message);
      console.log('model:', model);
      console.log('temperature:', temperature);
      console.log('maxTokens:', maxTokens);
      console.log('system message:', systemMessage);
      console.log('chat context turns:', chatContextTurns);
      console.log('conversation memory:\n', aiState.memory);
    }
  } catch (error) {
    const errorData = error?.response?.data?.error || error;
    const errorCode = errorData?.code || error;
    new Notice(`LangChain error: ${errorCode}`);
    console.error(errorData);
  }
};
