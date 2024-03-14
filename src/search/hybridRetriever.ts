import { extractNoteTitles, getNotePathFromTitle } from "@/utils";
import VectorDBManager from "@/vectorDBManager";
import { BaseRetriever } from "@langchain/core/retrievers";
import { VectorStore } from "@langchain/core/vectorstores";
import { Document } from "langchain/document";
import {
  ScoreThresholdRetriever,
  ScoreThresholdRetrieverInput,
} from "langchain/retrievers/score_threshold";
import { Vault } from "obsidian";

export class HybridRetriever<V extends VectorStore> extends BaseRetriever {
  public lc_namespace = ["hybrid_retriever"];

  constructor(
    private db: PouchDB.Database,
    private vault: Vault,
    private options: ScoreThresholdRetrieverInput<V>,
    private debug?: boolean,
  ) {
    super();
  }

  async getRelevantDocuments(query: string): Promise<Document[]> {
    // Extract note titles wrapped in [[]] from the query
    const noteTitles = extractNoteTitles(query);
    // Retrieve chunks for explicitly mentioned note titles
    const explicitChunks = await this.getExplicitChunks(noteTitles);
    if (this.debug) {
      console.log(
        "*** HYBRID RETRIEVER DEBUG INFO: ***",
        "\nHybrid Retriever Query: ",
        query,
        "\nNote Titles extracted: ",
        noteTitles,
        "\nExplicit Chunks:",
        explicitChunks,
      );
    }

    // Perform vector similarity search using ScoreThresholdRetriever
    const vectorChunks = await this.getVectorChunks(query);

    // Combine explicit and vector chunks, removing duplicates while maintaining order
    const uniqueChunks = new Set<string>(
      explicitChunks.map((chunk) => chunk.pageContent),
    );
    const combinedChunks: Document[] = [...explicitChunks];

    for (const chunk of vectorChunks) {
      const chunkContent = chunk.pageContent;
      if (!uniqueChunks.has(chunkContent)) {
        uniqueChunks.add(chunkContent);
        combinedChunks.push(chunk);
      }
    }

    // Make sure the combined chunks are at most maxK
    return combinedChunks.slice(0, this.options.maxK);
  }

  private async getExplicitChunks(noteTitles: string[]): Promise<Document[]> {
    const explicitChunks: Document[] = [];
    for (const noteTitle of noteTitles) {
      const notePath = getNotePathFromTitle(this.vault, noteTitle);
      const docHash = VectorDBManager.getDocumentHash(notePath ?? "");
      const memoryVectors = await VectorDBManager.getMemoryVectors(
        this.db,
        docHash,
      );
      if (memoryVectors) {
        const matchingChunks = memoryVectors.map(
          (memoryVector) =>
            new Document({
              pageContent: memoryVector.content,
              metadata: memoryVector.metadata,
            }),
        );
        explicitChunks.push(...matchingChunks);
      }
    }
    return explicitChunks;
  }

  private async getVectorChunks(query: string): Promise<Document[]> {
    const retriever = ScoreThresholdRetriever.fromVectorStore(
      this.options.vectorStore,
      {
        minSimilarityScore: this.options.minSimilarityScore,
        maxK: this.options.maxK,
        kIncrement: this.options.kIncrement,
      },
    );
    const vectorChunks = await retriever.getRelevantDocuments(query);
    return vectorChunks;
  }
}
