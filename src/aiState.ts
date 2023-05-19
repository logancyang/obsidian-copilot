import { ConversationChain } from "langchain/chains";
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { BufferWindowMemory } from "langchain/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
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
  memory: BufferWindowMemory;
  langChainParams: LangChainParams;

  constructor(langChainParams: LangChainParams) {
    this.langChainParams = langChainParams;
    this.memory = new BufferWindowMemory({
      k: this.langChainParams.chatContextTurns * 2,
      memoryKey: 'history',
      returnMessages: true,
    });

    this.createNewChain();
  }

  clearChatMemory(): void {
    console.log('clearing chat memory');
    this.memory.clear();
    this.createNewChain();
  }

  setModel(newModel: string): void {
    console.log('setting model to', newModel);
    this.langChainParams.model = newModel;
    this.createNewChain();
  }

  createNewChain(): void {
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

    AIState.chain = new ConversationChain({
      llm: AIState.chatOpenAI,
      memory: this.memory,
      prompt: chatPrompt,
    });
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
