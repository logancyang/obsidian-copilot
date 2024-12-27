import { CustomError } from "@/error";
import { getSettings } from "@/settings/model";
import { create, load, Orama, RawData, save } from "@orama/orama";
import { App } from "obsidian";

const CHUNK_PREFIX = "copilot-index-chunk-";
const LEGACY_INDEX_SUFFIX = ".json";

export interface ChunkMetadata {
  numPartitions: number;
  vectorLength: number;
  schema: any;
  lastModified: number;
  documentPartitions: Record<string, number>;
}

export class ChunkedStorage {
  constructor(
    private app: App,
    private baseDir: string,
    private identifier: string
  ) {}

  private getChunkPath(chunkIndex: number): string {
    return `${this.baseDir}/${CHUNK_PREFIX}${this.identifier}-${chunkIndex}.json`;
  }

  public getMetadataPath(): string {
    return `${this.baseDir}/${CHUNK_PREFIX}${this.identifier}-metadata.json`;
  }

  private getLegacyPath(): string {
    return `${this.baseDir}/copilot-index-${this.identifier}${LEGACY_INDEX_SUFFIX}`;
  }

  public assignDocumentToPartition(docId: string, totalPartitions: number): number {
    // 1. Convert string to array of characters
    const chars = Array.from(docId); // e.g., "abc" -> ['a', 'b', 'c']

    // 2. Create a hash using the djb2 algorithm
    const hash = chars.reduce((acc, char) => {
      // For each character:
      // a. Left shift acc by 5 (multiply by 32): acc << 5
      // b. Subtract original acc: (acc << 5) - acc
      //    This is equivalent to: acc * 31
      // c. Add character code: + char.charCodeAt(0)
      return (acc << 5) - acc + char.charCodeAt(0);
    }, 0);

    // 3. Take absolute value and modulo to get partition number
    return Math.abs(hash) % totalPartitions;
  }

  private distributeDocumentsToPartitions(
    documents: any[],
    numPartitions: number
  ): Map<number, any[]> {
    const partitions = new Map<number, any[]>();
    const documentPartitions: Record<string, number> = {};

    for (let i = 0; i < numPartitions; i++) {
      partitions.set(i, []);
    }

    if (getSettings().debug) {
      console.log(`Total documents to distribute: ${documents.length}`);
    }

    for (const doc of documents) {
      const partitionIndex = this.assignDocumentToPartition(doc.id, numPartitions);
      const partition = partitions.get(partitionIndex);
      if (!partition) {
        throw new Error(`Invalid partition index: ${partitionIndex}`);
      }
      partition.push(doc);
      documentPartitions[doc.id] = partitionIndex;
    }

    let totalDistributed = 0;
    partitions.forEach((docs, i) => {
      totalDistributed += docs.length;
      if (getSettings().debug) {
        console.log(`Partition ${i + 1}: ${docs.length} documents`);
      }
    });

    if (getSettings().debug) {
      console.log(`Total documents distributed: ${totalDistributed}`);
      if (totalDistributed !== documents.length) {
        console.error(
          `Document count mismatch! Original: ${documents.length}, Distributed: ${totalDistributed}`
        );
      }
    }

    return partitions;
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (!(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }
  }

  async saveDatabase(db: Orama<any>): Promise<void> {
    try {
      const rawData: RawData = await save(db);
      const numPartitions = getSettings().numPartitions;

      if (numPartitions === 1) {
        const legacyPath = this.getLegacyPath();
        await this.ensureDirectoryExists(legacyPath);
        await this.app.vault.adapter.write(
          legacyPath,
          JSON.stringify({
            ...rawData,
            schema: db.schema,
          })
        );
        return;
      }

      // NOTE: Orama RawData docs can be either an array or an object
      const docsData = (rawData as any).docs?.docs;
      const rawDocs = Array.isArray(docsData) ? docsData : Object.values(docsData || {});

      if (getSettings().debug) {
        console.log(`Starting save with ${rawDocs.length ?? 0} total documents`);
      }

      if (!rawDocs || rawDocs.length === 0) {
        const metadata: ChunkMetadata = {
          numPartitions,
          vectorLength: db.schema.embedding.match(/\d+/)[0],
          schema: db.schema,
          lastModified: Date.now(),
          documentPartitions: {},
        };

        const metadataPath = this.getMetadataPath();
        await this.ensureDirectoryExists(metadataPath);
        await this.app.vault.adapter.write(metadataPath, JSON.stringify(metadata));

        if (getSettings().debug) {
          console.log("Saved empty database state");
        }
        return;
      }

      const partitions = this.distributeDocumentsToPartitions(rawDocs, numPartitions);

      const metadata: ChunkMetadata = {
        numPartitions,
        vectorLength: db.schema.embedding.match(/\d+/)[0],
        schema: db.schema,
        lastModified: Date.now(),
        documentPartitions: Object.fromEntries(
          rawDocs.map((doc: any) => [doc.id, this.assignDocumentToPartition(doc.id, numPartitions)])
        ),
      };

      await this.saveMetadata(metadata);
      // Create global data object (excluding partitioned fields)
      const globalData = {
        ...rawData,
        docs: { docs: {}, count: 0 },
        index: {
          ...(rawData as any).index,
          vectorIndexes: undefined,
        },
      };

      // Save partitions
      for (const [partitionIndex, docs] of partitions.entries()) {
        // Create partition-specific data
        const partitionData = {
          index: {
            vectorIndexes: {
              embedding: {
                size: (rawData as any).index.vectorIndexes.embedding.size,
                vectors: Object.fromEntries(
                  Object.entries((rawData as any).index.vectorIndexes.embedding.vectors).filter(
                    ([id]) => docs.some((doc) => doc.id === id)
                  )
                ),
              },
            },
          },
          docs: {
            docs: Object.fromEntries(docs.map((doc, index) => [(index + 1).toString(), doc])),
            count: docs.length,
          },
        };

        // For first partition, include global data
        const finalPartitionData =
          partitionIndex === 0
            ? {
                ...globalData,
                docs: partitionData.docs,
                index: {
                  ...globalData.index,
                  vectorIndexes: partitionData.index.vectorIndexes,
                },
              }
            : partitionData;

        const chunkPath = this.getChunkPath(partitionIndex);
        await this.ensureDirectoryExists(chunkPath);
        await this.app.vault.adapter.write(chunkPath, JSON.stringify(finalPartitionData));

        if (getSettings().debug) {
          console.log(`Saved partition ${partitionIndex + 1}/${numPartitions}`);
        }
      }
      if (getSettings().debug) {
        console.log("Saved all partitions");
      }
    } catch (error) {
      console.error(`Error saving database:`, error);
      throw new CustomError(`Failed to save database: ${error.message}`);
    }
  }

  async loadDatabase(): Promise<Orama<any>> {
    try {
      const legacyPath = this.getLegacyPath();

      // Try loading legacy format first
      if (await this.app.vault.adapter.exists(legacyPath)) {
        const legacyData = JSON.parse(await this.app.vault.adapter.read(legacyPath));
        if (!legacyData?.schema) {
          throw new CustomError("Invalid legacy database format");
        }
        const newDb = await create({
          schema: legacyData.schema,
          components: {
            tokenizer: {
              stemmer: undefined,
              stopWords: undefined,
            },
          },
        });
        await load(newDb, legacyData);
        return newDb;
      }

      // Load metadata
      const metadata = await this.loadMetadata();
      const newDb = await create({
        schema: metadata.schema,
        components: {
          tokenizer: {
            stemmer: undefined,
            stopWords: undefined,
          },
        },
      });

      // Load and merge all partitions
      let mergedData = null;
      const allChunks = [];

      // First, load all chunks
      for (let i = 0; i < metadata.numPartitions; i++) {
        const chunkPath = this.getChunkPath(i);
        if (await this.app.vault.adapter.exists(chunkPath)) {
          const chunkData = JSON.parse(await this.app.vault.adapter.read(chunkPath));
          allChunks.push(chunkData);

          // First chunk contains global data
          if (i === 0) {
            mergedData = chunkData;
          }
        }
      }

      if (!mergedData) {
        throw new CustomError("No data found in chunks");
      }

      // Create new docs object based on internalDocumentIDStore order
      const orderedDocs: Record<string, any> = {};
      let nextDocId = 1;

      for (const internalId of mergedData.internalDocumentIDStore.internalIdToId) {
        // Find document in any chunk
        const doc = allChunks
          .flatMap((chunk) => Object.values(chunk.docs.docs))
          .find((doc: any) => (doc as any).id === internalId);

        if (doc) {
          orderedDocs[nextDocId.toString()] = doc;
          nextDocId++;
        } else if (getSettings().debug) {
          console.warn(`Document ${internalId} not found in any chunk`);
        }
      }

      // Replace docs with ordered version
      mergedData.docs.docs = orderedDocs;
      mergedData.docs.count = Object.keys(orderedDocs).length;

      // Merge vectors from all chunks
      mergedData.index.vectorIndexes.embedding.vectors = Object.assign(
        {},
        ...allChunks.map((chunk) => chunk.index?.vectorIndexes?.embedding?.vectors || {})
      );

      // Load merged data into database
      await load(newDb, mergedData);
      return newDb;
    } catch (error) {
      console.error(`Error loading database:`, error);
      throw new CustomError(`Failed to load database: ${error.message}`);
    }
  }

  async clearStorage(): Promise<void> {
    try {
      // First try to remove legacy file if it exists
      const legacyPath = this.getLegacyPath();
      if (await this.app.vault.adapter.exists(legacyPath)) {
        await this.app.vault.adapter.remove(legacyPath);
      }

      // Get list of all files in the base directory
      const files = await this.app.vault.adapter.list(this.baseDir);

      // Remove all files that match our index pattern
      for (const file of files.files) {
        if (file.startsWith(`${this.baseDir}/${CHUNK_PREFIX}${this.identifier}`)) {
          await this.app.vault.adapter.remove(file);
        }
      }
    } catch (error) {
      console.error(`Error clearing storage:`, error);
      throw new CustomError(`Failed to clear storage: ${error.message}`);
    }
  }

  async exists(): Promise<boolean> {
    const legacyPath = this.getLegacyPath();

    if (getSettings().numPartitions === 1) {
      return await this.app.vault.adapter.exists(legacyPath);
    }

    const metadataPath = this.getMetadataPath();
    return (
      (await this.app.vault.adapter.exists(metadataPath)) ||
      (await this.app.vault.adapter.exists(legacyPath))
    );
  }

  // Helper method to load metadata
  private async loadMetadata(): Promise<ChunkMetadata> {
    const metadataPath = this.getMetadataPath();
    if (!(await this.app.vault.adapter.exists(metadataPath))) {
      throw new CustomError("No existing database found");
    }

    const metadata: ChunkMetadata = JSON.parse(await this.app.vault.adapter.read(metadataPath));
    if (!metadata?.schema) {
      throw new CustomError("Invalid metadata file: missing schema");
    }

    return metadata;
  }

  // Helper method to save metadata
  private async saveMetadata(metadata: ChunkMetadata): Promise<void> {
    const metadataPath = this.getMetadataPath();
    await this.ensureDirectoryExists(metadataPath);
    await this.app.vault.adapter.write(metadataPath, JSON.stringify(metadata));
  }
}
