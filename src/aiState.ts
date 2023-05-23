import ChainFactory, {
  CONVERSATION_CHAIN,
  CONVERSATIONAL_RETRIEVAL_QA_CHAIN,
} from '@/chainFactory';
import { AI_SENDER, DEFAULT_SYSTEM_PROMPT, USER_SENDER } from '@/constants';
import { ChatMessage } from '@/sharedState';
import { ConversationalRetrievalQAChain, ConversationChain } from "langchain/chains";
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { BufferWindowMemory } from "langchain/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { AIChatMessage, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { useState } from 'react';

export interface LangChainParams {
  key: string,
  model: string,
  temperature: number,
  maxTokens: number,
  systemMessage: string,
  chatContextTurns: number,
}

class AIState {
  static chatOpenAI: ChatOpenAI;
  static chain: ConversationChain;
  static conversationalRetrievalQAChain: ConversationalRetrievalQAChain;
  memory: BufferWindowMemory;
  langChainParams: LangChainParams;

  constructor(langChainParams: LangChainParams) {
    this.langChainParams = langChainParams;
    this.memory = new BufferWindowMemory({
      k: this.langChainParams.chatContextTurns * 2,
      memoryKey: 'history',
      returnMessages: true,
    });

    this.createNewChain(CONVERSATION_CHAIN);
  }

  clearChatMemory(): void {
    console.log('clearing chat memory');
    this.memory.clear();
    this.createNewChain(CONVERSATION_CHAIN);
  }

  setModel(newModel: string): void {
    console.log('setting model to', newModel);
    this.langChainParams.model = newModel;
    this.createNewChain(CONVERSATION_CHAIN);
  }

  createNewChain(chainType: string): void {
    const {
      key, model, temperature, maxTokens, systemMessage,
    } = this.langChainParams;

    const chatPrompt = ChatPromptTemplate.fromPromptMessages([
      SystemMessagePromptTemplate.fromTemplate(systemMessage),
      new MessagesPlaceholder("history"),
      HumanMessagePromptTemplate.fromTemplate("{input}"),
    ]);

    AIState.chatOpenAI = new ChatOpenAI({
      openAIApiKey: key,
      modelName: model,
      temperature: temperature,
      maxTokens: maxTokens,
      streaming: true,
    });

    // TODO: Use this once https://github.com/hwchase17/langchainjs/issues/1327 is resolved
    if (chainType === CONVERSATION_CHAIN) {
      AIState.chain = ChainFactory.getChain(chainType, {
        llm: AIState.chatOpenAI,
        memory: this.memory,
        prompt: chatPrompt,
      }) as ConversationChain;
    } else if (chainType === CONVERSATIONAL_RETRIEVAL_QA_CHAIN) {
      // TODO: Create CONVERSATIONAL_RETRIEVAL_QA_CHAIN
      // AIState.conversationalRetrievalQAChain = ChainFactory.getChain(
      //   chainType,
      //   {},
      // );
    }

  }

  async countTokens(inputStr: string): Promise<number> {
    return AIState.chatOpenAI.getNumTokens(inputStr);
  }

  async runChatOpenAI(
    userMessage: ChatMessage,
    chatContext: ChatMessage[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    debug = false,
  ) {
    if (debug) {
      for (const [i, chatMessage] of chatContext.entries()) {
        console.log(
          `chat message ${i}:\nsender: ${chatMessage.sender}\n${chatMessage.message}`
        );
      }
    }

    const systemMessage = this.langChainParams.systemMessage || DEFAULT_SYSTEM_PROMPT;
    const messages = [
      new SystemChatMessage(systemMessage),
      ...chatContext.map((chatMessage) => {
        return chatMessage.sender === USER_SENDER
          ? new HumanChatMessage(chatMessage.message)
          : new AIChatMessage(chatMessage.message);
      }),
      new HumanChatMessage(userMessage.message),
    ];

    let fullAIResponse = '';
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

    addMessage({
      message: fullAIResponse,
      sender: AI_SENDER,
      isVisible: true,
    });
    updateCurrentAiMessage('');
    return fullAIResponse;
  }

  async runChain(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    debug = false,
  ) {
    if (debug) {
      console.log('Chat memory:', this.memory);
    }
    let fullAIResponse = '';
    // TODO: chain.call stop signal gives error:
    // "input values have 2 keys, you must specify an input key or pass only 1 key as input".
    // Follow up with LangchainJS: https://github.com/hwchase17/langchainjs/issues/1327
    await AIState.chain.call(
      {
        input: userMessage,
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
    return fullAIResponse;
  }
}


export function useAIState(
  aiState: AIState,
): [
  string,
  (model: string) => void,
  () => void,
] {
  const { langChainParams } = aiState;
  const [currentModel, setCurrentModel] = useState<string>(langChainParams.model);
  const [, setChatMemory] = useState<BufferWindowMemory | null>(aiState.memory);

  const clearChatMemory = () => {
    aiState.clearChatMemory();
    setChatMemory(aiState.memory);
  };

  const setModel = (newModel: string) => {
    aiState.setModel(newModel);
    setCurrentModel(newModel);
  };

  return [
    currentModel,
    setModel,
    clearChatMemory,
  ];
}

export default AIState;
