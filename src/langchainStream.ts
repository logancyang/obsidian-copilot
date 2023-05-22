import AIState from '@/aiState';
import { AI_SENDER, DEFAULT_SYSTEM_PROMPT, USER_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import { AIChatMessage, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
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
  const systemMessage = aiState.langChainParams.systemMessage || DEFAULT_SYSTEM_PROMPT;
  const messages = [
    new SystemChatMessage(systemMessage),
    ...chatContext.map((chatMessage) => {
      return chatMessage.sender === USER_SENDER
        ? new HumanChatMessage(chatMessage.message)
        : new AIChatMessage(chatMessage.message);
    }),
    new HumanChatMessage(userMessage.message),
  ];

  const abortController = new AbortController();
  let fullAIResponse = '';

  try {
    updateShouldAbort(abortController);

    // TODO: chain.call stop signal gives error:
    // "input values have 2 keys, you must specify an input key or pass only 1 key as input".
    // Follow up with LangchainJS: https://github.com/hwchase17/langchainjs/issues/1327
    await AIState.chatOpenAI.call(
      messages,
      { signal: abortController.signal },
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
      for (const [i, chatMessage] of chatContext.entries()) {
        console.log(
          `chat message ${i}:\nsender: ${chatMessage.sender}\n${chatMessage.message}`
        );
      }
    }
  }
};
