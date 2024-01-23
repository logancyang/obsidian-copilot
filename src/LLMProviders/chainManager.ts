import { LangChainParams, SetChainOptions } from '@/aiParams';
import ChainFactory, {
  ChainType
} from '@/chainFactory';
import {
  AI_SENDER,
  ChatModelDisplayNames
} from '@/constants';
import { ProxyChatOpenAI } from '@/langchainWrappers';
import { ChatMessage } from '@/sharedState';
import { getModelName, isSupportedChain } from '@/utils';
import VectorDBManager, { MemoryVector } from '@/vectorDBManager';
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  RetrievalQAChain
} from "langchain/chains";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder
} from "langchain/prompts";
import { ContextualCompressionRetriever } from "langchain/retrievers/contextual_compression";
import { LLMChainExtractor } from "langchain/retrievers/document_compressors/chain_extract";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Notice } from 'obsidian';
import ChatModelManager from './chatModelManager';
import EmbeddingsManager from './embeddingManager';
import MemoryManager from './memoryManager';
import PromptManager from './promptManager';

export default class ChainManager {
  private static chain: BaseChain;
  private static retrievalChain: RetrievalQAChain;
  private static conversationalRetrievalChain: ConversationalRetrievalQAChain;

  private static isOllamaModelActive = false;
  private static isOpenRouterModelActive = false;

  private vectorStore: MemoryVectorStore;
  private promptManager: PromptManager;
  private embeddingsManager: EmbeddingsManager;
  public chatModelManager: ChatModelManager;
  public langChainParams: LangChainParams;
  public memoryManager: MemoryManager;

  /**
   * Constructor for initializing langChainParams and instantiating singletons.
   *
   * @param {LangChainParams} langChainParams - the parameters for language chaining
   * @return {void}
   */
  constructor(
    langChainParams: LangChainParams
  ) {
    // Instantiate singletons
    this.langChainParams = langChainParams;
    this.memoryManager = MemoryManager.getInstance(this.langChainParams);
    this.chatModelManager = ChatModelManager.getInstance(this.langChainParams);
    this.promptManager = PromptManager.getInstance(this.langChainParams);
    this.embeddingsManager = EmbeddingsManager.getInstance(this.langChainParams);
    this.createChainWithNewModel(this.langChainParams.modelDisplayName);
  }

  private setNoteContent(noteContent: string): void {
    this.langChainParams.options.noteContent = noteContent;
  }

  private validateChainType(chainType: ChainType): void {
    if (chainType === undefined || chainType === null) throw new Error('No chain type set');
  }

  /**
   * Update the active model and create a new chain
   * with the specified model display name.
   *
   * @param {string} newModelDisplayName - the display name of the new model in the dropdown
   * @return {void}
   */
  createChainWithNewModel(newModelDisplayName: string): void {
    ChainManager.isOllamaModelActive = newModelDisplayName === ChatModelDisplayNames.OLLAMA;
    ChainManager.isOpenRouterModelActive = newModelDisplayName === ChatModelDisplayNames.OPENROUTERAI;
    // model and model display name must be update at the same time!
    let newModel = getModelName(newModelDisplayName);

    switch (newModelDisplayName) {
      case ChatModelDisplayNames.OLLAMA:
        newModel = this.langChainParams.ollamaModel;
        break;
      case ChatModelDisplayNames.LM_STUDIO:
        newModel = 'check_model_in_lm_studio_ui';
        break;
      case ChatModelDisplayNames.OPENROUTERAI:
        newModel = this.langChainParams.openRouterModel;
        break;
    }

    try {
      this.langChainParams.model = newModel;
      this.langChainParams.modelDisplayName = newModelDisplayName;
      this.chatModelManager.setChatModel(newModelDisplayName);
      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.createChain(
        this.langChainParams.chainType,
        {...this.langChainParams.options, forceNewCreation: true},
      )
      console.log(`Setting model to ${newModelDisplayName}: ${newModel}`);
    } catch (error) {
      console.error("createChainWithNewModel failed: ", error);
      console.log("model:", this.langChainParams.model);
    }
  }

  /* Create a new chain, or update chain with new model */
  createChain(
    chainType: ChainType,
    options?: SetChainOptions,
  ): void {
    this.validateChainType(chainType);
    try {
      this.setChain(chainType, options);
    } catch (error) {
      new Notice('Error creating chain:', error);
      console.error('Error creating chain:', error);
    }
  }

  async setChain(
    chainType: ChainType,
    options: SetChainOptions = {},
  ): Promise<void> {
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      // No need to throw error and trigger multiple Notices to user
      console.error('setChain failed: No chat model set.');
      return;
    }
    this.validateChainType(chainType);

    // Get chatModel, memory, prompt, and embeddingAPI from respective managers
    const chatModel = this.chatModelManager.getChatModel();
    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();
    const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();

    switch (chainType) {
      case ChainType.LLM_CHAIN: {
        // For initial load of the plugin
        if (options.forceNewCreation) {
          // setChain is async, this is to ensure Ollama has the right model passed in from the setting
          if (ChainManager.isOllamaModelActive) {
            (chatModel as ChatOllama).model = this.langChainParams.ollamaModel;
          } else if (ChainManager.isOpenRouterModelActive) {
            (chatModel as ProxyChatOpenAI).modelName = this.langChainParams.openRouterModel;
          }

          ChainManager.chain = ChainFactory.createNewLLMChain({
            llm: chatModel,
            memory: memory,
            prompt: options.prompt || chatPrompt,
          }) as ConversationChain;
        } else {
          // For navigating back to the plugin view
          ChainManager.chain = ChainFactory.getLLMChainFromMap({
            llm: chatModel,
            memory: memory,
            prompt: options.prompt || chatPrompt,
          }) as ConversationChain;
        }

        this.langChainParams.chainType = ChainType.LLM_CHAIN;
        break;
      }
      case ChainType.RETRIEVAL_QA_CHAIN: {
        if (!options.noteContent) {
          new Notice('No note content provided');
          throw new Error('No note content provided');
        }

        this.setNoteContent(options.noteContent);
        const docHash = VectorDBManager.getDocumentHash(options.noteContent);
        const parsedMemoryVectors: MemoryVector[] | undefined = await VectorDBManager.getMemoryVectors(docHash);
        if (parsedMemoryVectors) {
          const vectorStore = await VectorDBManager.rebuildMemoryVectorStore(
            parsedMemoryVectors, embeddingsAPI
          );
          ChainManager.retrievalChain = RetrievalQAChain.fromLLM(
            chatModel,
            vectorStore.asRetriever(),
          );
          console.log('Existing vector store for document hash: ', docHash);
        } else {
          await this.buildIndex(options.noteContent, docHash);
          if (!this.vectorStore) {
            console.error('Error creating vector store.');
            return;
          }

          const baseCompressor = LLMChainExtractor.fromLLM(chatModel);
          const retriever = new ContextualCompressionRetriever({
            baseCompressor,
            baseRetriever: this.vectorStore.asRetriever(),
          });
          ChainManager.retrievalChain = RetrievalQAChain.fromLLM(
            chatModel,
            retriever,
          );
          console.log(
            'New retrieval qa chain with contextual compression created for '
            + 'document hash: ', docHash
          );
        }

        this.langChainParams.chainType = ChainType.RETRIEVAL_QA_CHAIN;
        console.log('Set chain:', ChainType.RETRIEVAL_QA_CHAIN);
        break;
      }
      default:
        this.validateChainType(chainType);
        break;
    }
  }

  async buildIndex(noteContent: string, docHash: string): Promise<void> {
    const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

    const docs = await textSplitter.createDocuments([noteContent]);
    const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();

    // Note: HF can give 503 errors frequently (it's free)
    console.log('Creating vector store...');
    try {
      this.vectorStore = await MemoryVectorStore.fromDocuments(
        docs, embeddingsAPI,
      );
      // Serialize and save vector store to PouchDB
      VectorDBManager.setMemoryVectors(this.vectorStore.memoryVectors, docHash);
      console.log('Vector store created successfully.');
      new Notice('Vector store created successfully.');
    } catch (error) {
      new Notice('Failed to create vector store, please try again:', error);
      console.error('Failed to create vector store, please try again.:', error);
    }
  }

  async runChain(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: { debug?: boolean, ignoreSystemMessage?: boolean } = {},
  ) {
    const { debug = false, ignoreSystemMessage = false } = options;

    // Check if chat model is initialized
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      const errorMsg = 'Chat model is not initialized properly, check your API key in Copilot setting and make sure you have API access.';
      new Notice(errorMsg);
      console.error(errorMsg);
      return;
    }
    // Check if chain is initialized properly
    if (!ChainManager.chain || !isSupportedChain(ChainManager.chain)) {
      console.error(
        'Chain is not initialized properly, re-initializing chain: ',
        this.langChainParams.chainType
      );
      this.setChain(this.langChainParams.chainType, this.langChainParams.options);
    }

    const {
      temperature,
      maxTokens,
      systemMessage,
      chatContextTurns,
      chainType,
    } = this.langChainParams;

    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();
    const systemPrompt = ignoreSystemMessage ? '' : systemMessage;
    // Whether to ignore system prompt (for commands)
    if (ignoreSystemMessage) {
      const effectivePrompt = ignoreSystemMessage
        ? ChatPromptTemplate.fromMessages([
            new MessagesPlaceholder("history"),
            HumanMessagePromptTemplate.fromTemplate("{input}"),
          ])
        : chatPrompt;

      this.setChain(chainType, {
        ...this.langChainParams.options,
        prompt: effectivePrompt,
      });
    } else {
      this.setChain(chainType, this.langChainParams.options);
    }

    let fullAIResponse = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain = ChainManager.chain as any;
    try {
      switch(chainType) {
        case ChainType.LLM_CHAIN:
          if (debug) {
            console.log(`*** DEBUG INFO ***\n`
              + `user message: ${userMessage}\n`
              // ChatOpenAI has modelName, some other ChatModels like ChatOllama have model
              + `model: ${chain.llm.modelName || chain.llm.model}\n`
              + `chain type: ${chainType}\n`
              + `temperature: ${temperature}\n`
              + `maxTokens: ${maxTokens}\n`
              + `system prompt: ${systemPrompt}\n`
              + `chat context turns: ${chatContextTurns}\n`,
            );
            console.log('chain:', chain);
            console.log('Chat memory:', memory);
          }
          await ChainManager.chain.call(
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
        case ChainType.RETRIEVAL_QA_CHAIN:
          if (debug) {
            console.log(`*** DEBUG INFO ***\n`
              + `user message: ${userMessage}\n`
              + `model: ${chain.llm.modelName}\n`
              + `chain type: ${chainType}\n`
              + `temperature: ${temperature}\n`
              + `maxTokens: ${maxTokens}\n`
              + `system prompt: ${systemPrompt}\n`
              + `chat context turns: ${chatContextTurns}\n`,
            );
            console.log('chain:', chain);
            console.log('embedding provider:', this.langChainParams.embeddingProvider);
          }
          await ChainManager.retrievalChain.call(
            {
              query: userMessage,
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
        default:
          console.error('Chain type not supported:', this.langChainParams.chainType);
      }
    } catch (error) {
      const errorData = error?.response?.data?.error || error;
      const errorCode = errorData?.code || error;
      if (errorCode === 'model_not_found') {
        const modelNotFoundMsg = "You do not have access to this model or the model does not exist, please check with your API provider.";
        new Notice(modelNotFoundMsg);
        console.error(modelNotFoundMsg);
      } else {
        new Notice(`LangChain error: ${errorCode}`);
        console.error(errorData);
      }
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
