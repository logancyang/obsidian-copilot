import VectorDBManager from "@/vectorDBManager";
import { BaseRetriever } from "@langchain/core/retrievers";
import { VectorStore } from "@langchain/core/vectorstores";
import { Document } from "langchain/document";
import {
  ScoreThresholdRetriever,
  ScoreThresholdRetrieverInput,
} from "langchain/retrievers/score_threshold";

export class HybridRetriever<V extends VectorStore> extends BaseRetriever {
  public lc_namespace = ["hybrid_retriever"];

  constructor(
    private db: PouchDB.Database,
    private options: ScoreThresholdRetrieverInput<V>,
  ) {
    super();
  }

  async getRelevantDocuments(query: string): Promise<Document[]> {
    // Extract note titles wrapped in [[]] from the query
    const noteTitles = this.extractNoteTitles(query);
    // Retrieve chunks for explicitly mentioned note titles
    const explicitChunks = await this.getExplicitChunks(noteTitles);
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

    return combinedChunks;
  }

  private extractNoteTitles(query: string): string[] {
    // Use a regular expression to extract note titles wrapped in [[]]
    const regex = /\[\[(.*?)\]\]/g;
    const matches = query.match(regex);
    return matches ? matches.map((match) => match.slice(2, -2)) : [];
  }

  private async getExplicitChunks(noteTitles: string[]): Promise<Document[]> {
    const explicitChunks: Document[] = [];
    for (const noteTitle of noteTitles) {
      const docHash = VectorDBManager.getDocumentHash(noteTitle);
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
