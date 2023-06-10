import ChainFactory, {
  LLM_CHAIN,
  RETRIEVAL_QA_CHAIN
} from '@/chainFactory';
import {
  AI_SENDER,
  COHEREAI,
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
import { VectorStore } from 'langchain/dist/vectorstores/base';
import { Embeddings } from "langchain/embeddings/base";
import { CohereEmbeddings } from "langchain/embeddings/cohere";
import { HuggingFaceInferenceEmbeddings } from "langchain/embeddings/hf";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { BufferWindowMemory } from "langchain/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "langchain/prompts";
import { ContextualCompressionRetriever } from "langchain/retrievers/contextual_compression";
import { LLMChainExtractor } from "langchain/retrievers/document_compressors/chain_extract";
import { AIChatMessage, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Notice } from 'obsidian';
import { useState } from 'react';

export interface LangChainParams {
  openAiApiKey: string,
  huggingfaceApiKey: string,
  cohereApiKey: string,
  model: string,
  temperature: number,
  maxTokens: number,
  systemMessage: string,
  chatContextTurns: number,
  embeddingProvider: string,
  chainType: string,
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  noteContent?: string | null;
}

class AIState {
  static chatOpenAI: ChatOpenAI;
  static chain: BaseChain;
  static retrievalChain: RetrievalQAChain;
  static conversationalRetrievalChain: ConversationalRetrievalQAChain;
  memory: BufferWindowMemory;
  langChainParams: LangChainParams;
  chatPrompt:  ChatPromptTemplate;
  vectorStore: VectorStore

  constructor(langChainParams: LangChainParams) {
    this.langChainParams = langChainParams;
    this.memory = new BufferWindowMemory({
      k: this.langChainParams.chatContextTurns * 2,
      memoryKey: 'history',
      inputKey: 'input',
      returnMessages: true,
    });
    this.chatPrompt = ChatPromptTemplate.fromPromptMessages([
      SystemMessagePromptTemplate.fromTemplate(
        this.langChainParams.systemMessage
      ),
      new MessagesPlaceholder("history"),
      HumanMessagePromptTemplate.fromTemplate("{input}"),
    ]);
    this.createNewChain(LLM_CHAIN);
  }

  clearChatMemory(): void {
    console.log('clearing chat memory');
    this.memory.clear();
  }

  setModel(newModel: string): void {
    console.log('setting model to', newModel);
    this.langChainParams.model = newModel;
    AIState.chatOpenAI.modelName = newModel;
  }

  getEmbeddingsAPI(): Embeddings {
    const OpenAIEmbeddingsAPI = new OpenAIEmbeddings({
      openAIApiKey: this.langChainParams.openAiApiKey,
      maxRetries: 3,
      maxConcurrency: 3,
      timeout: 10000,
    });
    switch(this.langChainParams.embeddingProvider) {
      case OPENAI:
        // Every OpenAIEmbedding call is giving a 'refused to set header user-agent'
        // It's generally not a problem.
        // TODO: Check if this error can be avoided.
        return OpenAIEmbeddingsAPI
      case HUGGINGFACE:
        // TODO: This does not have a timeout param, need to check in the future.
        return new HuggingFaceInferenceEmbeddings({
          apiKey: this.langChainParams.huggingfaceApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case COHEREAI:
        return new CohereEmbeddings({
          apiKey: this.langChainParams.cohereApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      default:
        console.error('No embedding provider set. Using OpenAI.');
        return OpenAIEmbeddingsAPI;
    }
  }

  /* Create a new chain, or update chain with new model */
  createNewChain(
    chainType: string,
    options?: SetChainOptions,
  ): void {
    const {
      openAiApiKey, model, temperature, maxTokens,
    } = this.langChainParams;

    if (!openAiApiKey) {
      new Notice(
        'No OpenAI API key provided. Please set it in Copilot settings, and restart the plugin.'
      );
      return;
    }

    AIState.chatOpenAI = new ChatOpenAI({
      openAIApiKey: openAiApiKey,
      modelName: model,
      temperature: temperature,
      maxTokens: maxTokens,
      streaming: true,
      maxRetries: 3,
      maxConcurrency: 3,
    });

    this.setChain(chainType, options);
  }

  async setChain(
    chainType: string,
    options: SetChainOptions = {},
  ): Promise<void> {
    switch (chainType) {
      case LLM_CHAIN: {
        AIState.chain = ChainFactory.getLLMChain({
          llm: AIState.chatOpenAI,
          memory: this.memory,
          prompt: options.prompt || this.chatPrompt,
        }) as ConversationChain;
        this.langChainParams.chainType = LLM_CHAIN;
        console.log('Set chain:', LLM_CHAIN);
        break;
      }
      case RETRIEVAL_QA_CHAIN: {
        if (!options.noteContent) {
          console.error('No note content provided.');
          return;
        }

        const docHash = ChainFactory.getDocumentHash(options.noteContent);
        const vectorStore = ChainFactory.vectorStoreMap.get(docHash);
        if (vectorStore) {
          AIState.retrievalChain = RetrievalQAChain.fromLLM(
            AIState.chatOpenAI,
            vectorStore.asRetriever(),
          );
          console.log('Existing vector store for document hash: ', docHash);
        } else {
          await this.buildIndex(options.noteContent, docHash);
          if (!this.vectorStore) {
            console.error('Error creating vector store.');
            return;
          }

          const baseCompressor = LLMChainExtractor.fromLLM(AIState.chatOpenAI);
          const retriever = new ContextualCompressionRetriever({
            baseCompressor,
            baseRetriever: this.vectorStore.asRetriever(),
          });
          AIState.retrievalChain = RetrievalQAChain.fromLLM(
            AIState.chatOpenAI,
            retriever,
          );
          console.log(
            'New retrieval qa chain with contextual compression created for '
            + 'document hash: ', docHash
          );
        }

        this.langChainParams.chainType = RETRIEVAL_QA_CHAIN;
        console.log('Set chain:', RETRIEVAL_QA_CHAIN);
        break;
      }
      default:
        console.error('No chain type set.');
        break;
    }
  }

  async buildIndex(noteContent: string, docHash: string): Promise<void> {
    const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

    const docs = await textSplitter.createDocuments([noteContent]);
    const embeddingsAPI = this.getEmbeddingsAPI();

    // Note: HF can give 503 errors frequently (it's free)
    console.log('Creating vector store...');
    try {
      this.vectorStore = await MemoryVectorStore.fromDocuments(
        docs, embeddingsAPI,
      );
      ChainFactory.setVectorStore(this.vectorStore, docHash);
      console.log('Vector store created successfully.');
    } catch (error) {
      new Notice('Failed to create vector store, please try again:', error);
      console.log('Failed to create vector store, please try again.:', error);
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
      switch(this.langChainParams.chainType) {
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
          if (debug) {
            console.log('embedding provider:', this.langChainParams.embeddingProvider);
          }
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
          console.error('Chain type not supported:', this.langChainParams.chainType);
      }
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
    }
    return fullAIResponse;
  }
}


export function useAIState(
  aiState: AIState,
): [
  string,
  (model: string) => void,
  string,
  (chain: string, options?: SetChainOptions) => void,
  () => void,
] {
  const { langChainParams } = aiState;
  const [currentModel, setCurrentModel] = useState<string>(langChainParams.model);
  const [currentChain, setCurrentChain] = useState<string>(langChainParams.chainType);
  const [, setChatMemory] = useState<BufferWindowMemory | null>(aiState.memory);

  const clearChatMemory = () => {
    aiState.clearChatMemory();
    setChatMemory(aiState.memory);
  };

  const setModel = (newModel: string) => {
    aiState.setModel(newModel);
    setCurrentModel(newModel);
  };

  const setChain = (newChain: string, options?: SetChainOptions) => {
    aiState.setChain(newChain, options);
    setCurrentChain(newChain);
  };

  return [
    currentModel,
    setModel,
    currentChain,
    setChain,
    clearChatMemory,
  ];
}

export default AIState;
