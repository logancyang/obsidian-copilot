import { extractNoteTitles, getNoteFileFromTitle } from "@/utils";
import VectorDBManager from "@/vectorDBManager";
import { BaseRetriever } from "@langchain/core/retrievers";
import { VectorStore } from "@langchain/core/vectorstores";
import { BaseLanguageModel } from "langchain/base_language";
import { Document } from "langchain/document";
import { ChatPromptTemplate } from "langchain/prompts";
import {
  ScoreThresholdRetriever,
  ScoreThresholdRetrieverInput,
} from "langchain/retrievers/score_threshold";
import { Vault } from "obsidian";

export class HybridRetriever<V extends VectorStore> extends BaseRetriever {
  public lc_namespace = ["hybrid_retriever"];

  private llm: BaseLanguageModel;
  private queryRewritePrompt: ChatPromptTemplate;

  constructor(
    private db: PouchDB.Database,
    private vault: Vault,
    private options: ScoreThresholdRetrieverInput<V>,
    llm: BaseLanguageModel,
    private debug?: boolean
  ) {
    super();
    this.llm = llm;
    this.queryRewritePrompt = ChatPromptTemplate.fromTemplate(
      "Please write a passage to answer the question.\nQuestion: {question}\nPassage:"
    );
  }

  async getRelevantDocuments(query: string): Promise<Document[]> {
    // Extract note titles wrapped in [[]] from the query
    const noteTitles = extractNoteTitles(query);
    // Retrieve chunks for explicitly mentioned note titles
    const explicitChunks = await this.getExplicitChunks(noteTitles);

    // Generate a hypothetical answer passage
    const rewrittenQuery = await this.rewriteQuery(query);
    // Perform vector similarity search using ScoreThresholdRetriever
    const vectorChunks = await this.getVectorChunks(rewrittenQuery);

    // Combine explicit and vector chunks, removing duplicates while maintaining order
    const uniqueChunks = new Set<string>(explicitChunks.map((chunk) => chunk.pageContent));
    const combinedChunks: Document[] = [...explicitChunks];

    for (const chunk of vectorChunks) {
      const chunkContent = chunk.pageContent;
      if (!uniqueChunks.has(chunkContent)) {
        uniqueChunks.add(chunkContent);
        combinedChunks.push(chunk);
      }
    }

    if (this.debug) {
      console.log(
        "*** HyDE HYBRID RETRIEVER DEBUG INFO: ***",
        "\nOriginal Query: ",
        query,
        "\n\nRewritten Query: ",
        rewrittenQuery,
        "\n\nNote Titles extracted: ",
        noteTitles,
        "\n\nExplicit Chunks:",
        explicitChunks,
        "\n\nVector Chunks:",
        vectorChunks,
        "\n\nCombined Chunks:",
        combinedChunks
      );
    }

    // Make sure the combined chunks are at most maxK
    return combinedChunks.slice(0, this.options.maxK);
  }

  private async rewriteQuery(query: string): Promise<string> {
    try {
      const promptResult = await this.queryRewritePrompt.format({ question: query });
      const rewrittenQueryObject = await this.llm.invoke(promptResult);

      // Directly return the content assuming it's structured as expected
      if (rewrittenQueryObject && "content" in rewrittenQueryObject) {
        return rewrittenQueryObject.content;
      }
      console.warn("Unexpected rewrittenQuery format. Falling back to original query.");
      return query;
    } catch (error) {
      console.error("Error in rewriteQuery:", error);
      // If there's an error, return the original query
      return query;
    }
  }

  private async getExplicitChunks(noteTitles: string[]): Promise<Document[]> {
    const explicitChunks: Document[] = [];
    for (const noteTitle of noteTitles) {
      const noteFile = await getNoteFileFromTitle(this.vault, noteTitle);
      const docHash = VectorDBManager.getDocumentHash(noteFile?.path ?? "");
      const memoryVectors = await VectorDBManager.getMemoryVectors(this.db, docHash);
      if (memoryVectors) {
        const matchingChunks = memoryVectors.map(
          (memoryVector) =>
            new Document({
              pageContent: memoryVector.content,
              metadata: memoryVector.metadata,
            })
        );
        explicitChunks.push(...matchingChunks);
      }
    }
    return explicitChunks;
  }

  private async getVectorChunks(query: string): Promise<Document[]> {
    const retriever = ScoreThresholdRetriever.fromVectorStore(this.options.vectorStore, {
      minSimilarityScore: this.options.minSimilarityScore,
      maxK: this.options.maxK,
      kIncrement: this.options.kIncrement,
    });
    const vectorChunks = await retriever.getRelevantDocuments(query);
    return vectorChunks;
  }
}
