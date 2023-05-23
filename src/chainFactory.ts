import {
  BaseChain,
  ConversationChain,
  ConversationalRetrievalQAChain,
  ConversationalRetrievalQAChainInput,
  LLMChainInput,
} from "langchain/chains";

// Add new chain types here
const CONVERSATION_CHAIN = 'ConversationChain';
const CONVERSATIONAL_RETRIEVAL_QA_CHAIN = 'ConversationalRetrievalQAChain';
const SUPPORTED_CHAIN_TYPES = new Set([
  CONVERSATION_CHAIN,
  CONVERSATIONAL_RETRIEVAL_QA_CHAIN,
]);

class ChainFactory {
  private static instances: Map<string, BaseChain> = new Map();

  public static getChain(
    chainType: string,
    args: LLMChainInput | ConversationalRetrievalQAChainInput
  ): BaseChain {
    let instance = ChainFactory.instances.get(chainType);
    if (!instance) {
      if (!SUPPORTED_CHAIN_TYPES.has(chainType)) {
        throw new Error(`Unsupported chain type: ${chainType}`);
      }

      if (chainType === CONVERSATION_CHAIN) {
        instance = new ConversationChain(args as LLMChainInput);
      } else if (chainType === CONVERSATIONAL_RETRIEVAL_QA_CHAIN) {
        instance = new ConversationalRetrievalQAChain(
          args as ConversationalRetrievalQAChainInput
        );
      } else {
        throw new Error(`Invalid arguments for chain type: ${chainType}`);
      }

      ChainFactory.instances.set(chainType, instance);
    }

    return instance;
  }
}

export default ChainFactory;
