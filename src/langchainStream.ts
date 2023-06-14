import AIState from '@/aiState';
import { ChatMessage } from '@/sharedState';

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
  // TODO: test new installation when there is no api key
  const {
    model,
    temperature,
    maxTokens,
    systemMessage,
    chatContextTurns,
  } = aiState.langChainParams;

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

  // await aiState.runChatModel(
  //   userMessage,
  //   chatContext,
  //   abortController,
  //   updateCurrentAiMessage,
  //   addMessage,
  //   debug,
  // )

  await aiState.runChain(
    userMessage.message,
    chatContext,
    abortController,
    updateCurrentAiMessage,
    addMessage,
    debug,
  );
};
