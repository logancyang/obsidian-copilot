import { CustomError } from "@/error";
import { getSettings } from "@/settings/model";
import { create, load, Orama, save } from "@orama/orama";
import { App } from "obsidian";
import { DBOperations } from "./dbOperations";

// TODO: Make this a setting
export const DEFAULT_NUM_PARTITIONS = 1;
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
      const partitionSize = new TextEncoder().encode(JSON.stringify(docs)).length;
      totalDistributed += docs.length;
      if (getSettings().debug) {
        console.log(
          `Partition ${i + 1}: ${Math.round((partitionSize / 1024 / 1024) * 100) / 100}MB with ${docs.length} documents`
        );
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
      const rawData = await save(db);
      const documents = await DBOperations.getAllDocuments(db);
      const numPartitions = DEFAULT_NUM_PARTITIONS;

      if (numPartitions === 1) {
        const legacyPath = this.getLegacyPath();
        await this.ensureDirectoryExists(legacyPath);
        await this.app.vault.adapter.write(
          legacyPath,
          JSON.stringify({
            ...rawData,
            documents: documents,
          })
        );
        return;
      }

      if (getSettings().debug) {
        console.log(`Starting save with ${documents.length} total documents`);
      }

      if (!documents || documents.length === 0) {
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

      const partitions = this.distributeDocumentsToPartitions(documents, numPartitions);

      const metadata: ChunkMetadata = {
        numPartitions,
        vectorLength: db.schema.embedding.match(/\d+/)[0],
        schema: db.schema,
        lastModified: Date.now(),
        documentPartitions: Object.fromEntries(
          documents.map((doc) => [doc.id, this.assignDocumentToPartition(doc.id, numPartitions)])
        ),
      };

      const metadataPath = this.getMetadataPath();
      await this.ensureDirectoryExists(metadataPath);
      await this.app.vault.adapter.write(metadataPath, JSON.stringify(metadata));

      for (const [partitionIndex, docs] of partitions.entries()) {
        const partitionData = {
          ...rawData,
          documents: docs,
        };
        const chunkPath = this.getChunkPath(partitionIndex);
        await this.ensureDirectoryExists(chunkPath);
        await this.app.vault.adapter.write(chunkPath, JSON.stringify(partitionData));

        if (getSettings().debug) {
          console.log(`Saved partition ${partitionIndex + 1}/${numPartitions}`);
        }
      }

      let savedTotal = 0;
      for (let i = 0; i < numPartitions; i++) {
        const chunkPath = this.getChunkPath(i);
        const chunkData = JSON.parse(await this.app.vault.adapter.read(chunkPath));
        savedTotal += chunkData.documents.length;
      }

      if (getSettings().debug) {
        console.log(
          `Completed save. Original count: ${documents.length}, Saved count: ${savedTotal}`
        );
        if (savedTotal !== documents.length) {
          console.error(
            `Document count mismatch during save! Original: ${documents.length}, Saved: ${savedTotal}`
          );
        }
      }
    } catch (error) {
      console.error(`Error saving database:`, error);
      throw new CustomError(`Failed to save database: ${error.message}`);
    }
  }

  async loadDatabase(): Promise<Orama<any>> {
    try {
      const legacyPath = this.getLegacyPath();

      if (await this.app.vault.adapter.exists(legacyPath)) {
        const legacyData = JSON.parse(await this.app.vault.adapter.read(legacyPath));
        const newDb = await create({
          schema: legacyData.schema,
          language: "english",
        });
        await load(newDb, legacyData);
        return newDb;
      }

      const metadataPath = this.getMetadataPath();
      const metadata: ChunkMetadata = JSON.parse(await this.app.vault.adapter.read(metadataPath));
      const newDb = await create({ schema: metadata.schema });

      for (let i = 0; i < metadata.numPartitions; i++) {
        const chunkPath = this.getChunkPath(i);
        const chunkData = JSON.parse(await this.app.vault.adapter.read(chunkPath));
        await load(newDb, chunkData);

        if (getSettings().debug) {
          console.log(`Loaded partition ${i + 1}/${metadata.numPartitions}`);
        }
      }

      return newDb;
    } catch (error) {
      console.error(`Error loading database:`, error);
      throw new CustomError(`Failed to load database: ${error.message}`);
    }
  }

  async clearStorage(): Promise<void> {
    try {
      const legacyPath = this.getLegacyPath();

      if (await this.app.vault.adapter.exists(legacyPath)) {
        await this.app.vault.adapter.remove(legacyPath);
        return;
      }

      if (DEFAULT_NUM_PARTITIONS > 1) {
        const metadataPath = this.getMetadataPath();
        if (await this.app.vault.adapter.exists(metadataPath)) {
          const metadata: ChunkMetadata = JSON.parse(
            await this.app.vault.adapter.read(metadataPath)
          );

          for (let i = 0; i < metadata.numPartitions; i++) {
            const chunkPath = this.getChunkPath(i);
            if (await this.app.vault.adapter.exists(chunkPath)) {
              await this.app.vault.adapter.remove(chunkPath);
            }
          }

          await this.app.vault.adapter.remove(metadataPath);
        }
      }
    } catch (error) {
      console.error(`Error clearing storage:`, error);
      throw new CustomError(`Failed to clear storage: ${error.message}`);
    }
  }

  async exists(): Promise<boolean> {
    const legacyPath = this.getLegacyPath();

    if (DEFAULT_NUM_PARTITIONS === 1) {
      return await this.app.vault.adapter.exists(legacyPath);
    }

    const metadataPath = this.getMetadataPath();
    return (
      (await this.app.vault.adapter.exists(metadataPath)) ||
      (await this.app.vault.adapter.exists(legacyPath))
    );
  }
}
