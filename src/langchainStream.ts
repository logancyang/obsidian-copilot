import { AI_SENDER, USER_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { AIChatMessage, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { Notice } from 'obsidian';

export type Role = 'assistant' | 'user' | 'system';

export interface LangChainParams {
  key: string,
  model: string,
  temperature: number,
  maxTokens: number,
  systemMessage: string,
}

export const getAIResponse = async (
  userMessage: ChatMessage,
  chatContext: ChatMessage[],
  langChainParams: LangChainParams,
  updateCurrentAiMessage: (message: string) => void,
  addMessage: (message: ChatMessage) => void,
  updateShouldAbort: (abortController: AbortController | null) => void,
  stream = true,
  debug = false,
) => {
  const {
    key, model, temperature, maxTokens, systemMessage,
  } = langChainParams;

  const messages = [
    new SystemChatMessage(systemMessage),
    ...chatContext.map((chatMessage) => {
      return chatMessage.sender === USER_SENDER
        ? new HumanChatMessage(chatMessage.message)
        : new AIChatMessage(chatMessage.message);
    }),
    new HumanChatMessage(userMessage.message),
  ];

  if (debug) {
    console.log('langChainParams:', langChainParams);
    console.log('system message:', systemMessage);
    for (const [i, chatMessage] of chatContext.entries()) {
      console.log(
        `chat message ${i}:\nsender: ${chatMessage.sender}\n${chatMessage.message}`
      );
    }
  }

  const abortController = new AbortController();

  try {
    let fullAIResponse = '';
    const chatOpenAI = new ChatOpenAI({
      openAIApiKey: key,
      modelName: model,
      temperature: temperature,
      maxTokens: maxTokens,
      streaming: stream,
      callbacks: [
        {
          handleLLMNewToken: (token) => {
            fullAIResponse += token;
            updateCurrentAiMessage(fullAIResponse);
          },
        },
      ],
    });

    updateShouldAbort(abortController);
    await chatOpenAI.call(
      messages,
      { signal: abortController.signal }
    );
    addMessage({
      message: fullAIResponse,
      sender: AI_SENDER,
      isVisible: true,
    });
    updateCurrentAiMessage('');

  } catch (error) {
    const errorData = error?.response?.data?.error || error;
    const errorCode = errorData?.code || error;
    new Notice(`LangChain error: ${errorCode}`);
    console.error(errorData);
  }
};
