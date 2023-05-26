import ChainFactory, {
  LLM_CHAIN,
  RETRIEVAL_QA_CHAIN
} from '@/chainFactory';
import {
  AI_SENDER,
  DEFAULT_SYSTEM_PROMPT,
  HUGGINGFACE,
  OPENAI,
  USER_SENDER
} from '@/constants';
import { ChatMessage } from '@/sharedState';
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  RetrievalQAChain,
} from "langchain/chains";
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { HuggingFaceInferenceEmbeddings } from "langchain/embeddings/hf";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { BufferWindowMemory } from "langchain/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { AIChatMessage, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Notice } from 'obsidian';
import { useState } from 'react';

export interface LangChainParams {
  key: string,
  huggingfaceApiKey: string,
  model: string,
  temperature: number,
  maxTokens: number,
  systemMessage: string,
  chatContextTurns: number,
  embeddingProvider: string,
}

interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  noteContent?: string;
}

class AIState {
  static chatOpenAI: ChatOpenAI;
  static chain: BaseChain;
  static retrievalChain: RetrievalQAChain;
  static conversationalRetrievalChain: ConversationalRetrievalQAChain;
  static useChain: string;
  memory: BufferWindowMemory;
  langChainParams: LangChainParams;

  constructor(langChainParams: LangChainParams) {
    this.langChainParams = langChainParams;
    this.memory = new BufferWindowMemory({
      k: this.langChainParams.chatContextTurns * 2,
      memoryKey: 'history',
      inputKey: 'input',
      returnMessages: true,
    });
    this.createNewChain(LLM_CHAIN);
  }

  clearChatMemory(): void {
    console.log('clearing chat memory');
    this.memory.clear();
    this.createNewChain(LLM_CHAIN);
    AIState.useChain = LLM_CHAIN;
  }

  setModel(newModel: string): void {
    console.log('setting model to', newModel);
    this.langChainParams.model = newModel;
    this.createNewChain(LLM_CHAIN);
  }

  getEmbeddingsAPI(): OpenAIEmbeddings | HuggingFaceInferenceEmbeddings {
    const OpenAIEmbeddingsAPI = new OpenAIEmbeddings({
      openAIApiKey: this.langChainParams.key,
      maxRetries: 3,
      maxConcurrency: 3,
    });
    switch(this.langChainParams.embeddingProvider) {
      case OPENAI:
        // Every OpenAIEmbedding call is giving a 'refused to set header user-agent'
        // It's generally not a problem.
        // TODO: Check if this error can be avoided.
        return OpenAIEmbeddingsAPI
      case HUGGINGFACE:
        return new HuggingFaceInferenceEmbeddings({
          apiKey: this.langChainParams.huggingfaceApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      default:
        console.error('No embedding provider set. Using OpenAI.');
        return OpenAIEmbeddingsAPI;
    }
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
      maxRetries: 3,
      maxConcurrency: 3,
    });

    this.setChain(chainType, {prompt: chatPrompt});
  }

  async setChain(
    chainType: string,
    options: SetChainOptions = {},
  ): Promise<void> {
    if (chainType === LLM_CHAIN && options.prompt) {
      AIState.chain = ChainFactory.getLLMChain({
        llm: AIState.chatOpenAI,
        memory: this.memory,
        prompt: options.prompt,
      }) as ConversationChain;
      AIState.useChain = LLM_CHAIN;
      console.log('Set chain:', LLM_CHAIN);
    } else if (chainType === RETRIEVAL_QA_CHAIN && options.noteContent) {
      const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });
      const docs = await textSplitter.createDocuments([options.noteContent]);
      const embeddingsAPI = this.getEmbeddingsAPI();

      try {
        // Note: HF can give 503 errors frequently (it's free)
        console.log('Creating vector store...');
        const vectorStore = await MemoryVectorStore.fromDocuments(
          docs, embeddingsAPI,
        );
        console.log('Vector store created successfully.');
        /* Create or retrieve the chain */
        AIState.retrievalChain = ChainFactory.getRetrievalChain({
          llm: AIState.chatOpenAI,
          retriever: vectorStore.asRetriever(),
        });
        AIState.useChain = RETRIEVAL_QA_CHAIN;
        console.log('Set chain:', RETRIEVAL_QA_CHAIN);
      } catch (error) {
        new Notice('Failed to create vector store, please try again:', error);
        console.log('Failed to create vector store, please try again.:', error);
        return;
      }
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
    chatContext: ChatMessage[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    debug = false,
  ) {
    let fullAIResponse = '';
    try {
      switch(AIState.useChain) {
        case LLM_CHAIN:
          if (debug) {
            console.log('Chat memory:', this.memory);
          }

          await AIState.chain.call(
            {
              input: userMessage,
              signal: abortController.signal,
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
          break;
        case RETRIEVAL_QA_CHAIN:
          await AIState.retrievalChain.call(
            {
              query: userMessage,
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
          break;
        default:
          console.error('Chain type not supported:', AIState.useChain);
      }
    } catch (error) {
      new Notice('Error running chain:', error);
      console.error('Error running chain:', error);
    } finally {
      addMessage({
        message: fullAIResponse,
        sender: AI_SENDER,
        isVisible: true,
      });
      updateCurrentAiMessage('');
    }
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
