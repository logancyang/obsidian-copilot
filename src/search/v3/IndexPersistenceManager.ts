import { App } from "obsidian";
import { getSettings } from "@/settings/model";
import { logInfo } from "@/logger";

export interface JsonlChunkRecord {
  id: string; // stable chunk id (hashable)
  path: string; // note path
  title: string;
  mtime: number;
  ctime: number;
  embedding: number[]; // precomputed embedding
}

/**
 * Manages persistence of the index to JSONL files
 */
export class IndexPersistenceManager {
  private static readonly DEFAULT_MAX_PARTITION_SIZE_MB = 150;
  private static readonly MAX_BYTES =
    IndexPersistenceManager.DEFAULT_MAX_PARTITION_SIZE_MB * 1024 * 1024;
  private static readonly MAX_PARTITIONS = 1000;
  private static readonly PARTITION_INDEX_PADDING = 3; // for padStart(3, "0")

  constructor(private app: App) {}

  /**
   * Get the base directory for index files
   */
  private async getIndexBase(): Promise<string> {
    const baseDir = getSettings().enableIndexSync
      ? this.app.vault.configDir // sync via .obsidian
      : ".copilot"; // store at vault root under .copilot

    // When not syncing, ensure folder exists at vault root
    try {
      // @ts-ignore
      const exists = await this.app.vault.adapter.exists(baseDir);
      if (!exists) {
        // @ts-ignore
        await this.app.vault.adapter.mkdir(baseDir);
      }
    } catch {
      // ignore
    }
    return `${baseDir}/copilot-index-v3`;
  }

  /**
   * Get the path for legacy single-file index
   */
  private async getLegacyIndexPath(): Promise<string> {
    const baseDir = this.app.vault.configDir;
    return `${baseDir}/copilot-index-v3.jsonl`;
  }

  /**
   * Get the path for a specific partition
   */
  private async getPartitionPath(index: number): Promise<string> {
    const base = await this.getIndexBase();
    const suffix = index.toString().padStart(IndexPersistenceManager.PARTITION_INDEX_PADDING, "0");
    return `${base}-${suffix}.jsonl`;
  }

  /**
   * Get all existing partition paths
   */
  async getExistingPartitionPaths(): Promise<string[]> {
    const paths: string[] = [];

    // Scan for existing partitions
    for (let i = 0; i < IndexPersistenceManager.MAX_PARTITIONS; i++) {
      const p = await this.getPartitionPath(i);
      // @ts-ignore
      if (await this.app.vault.adapter.exists(p)) {
        paths.push(p);
      } else {
        break;
      }
    }

    // Fallback to legacy single-file path
    if (paths.length === 0) {
      const legacy = await this.getLegacyIndexPath();
      // @ts-ignore
      if (await this.app.vault.adapter.exists(legacy)) {
        paths.push(legacy);
      }
    }

    return paths;
  }

  /**
   * Read all records from persisted index
   */
  async readRecords(): Promise<JsonlChunkRecord[]> {
    const paths = await this.getExistingPartitionPaths();
    if (paths.length === 0) {
      return [];
    }

    const allLines: string[] = [];
    for (const path of paths) {
      // @ts-ignore
      const content = await this.app.vault.adapter.read(path);
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      allLines.push(...lines);
    }

    return allLines.map((line) => JSON.parse(line) as JsonlChunkRecord);
  }

  /**
   * Write records to partitioned JSONL files
   */
  async writeRecords(records: JsonlChunkRecord[]): Promise<void> {
    const lines = records.map((r) => JSON.stringify(r));
    await this.writePartitions(lines);
  }

  /**
   * Write lines to partitioned files
   */
  private async writePartitions(lines: string[]): Promise<void> {
    // First, remove legacy single file if exists
    const legacy = await this.getLegacyIndexPath();
    // @ts-ignore
    if (await this.app.vault.adapter.exists(legacy)) {
      try {
        // @ts-ignore
        await this.app.vault.adapter.remove(legacy);
      } catch {
        // ignore
      }
    }

    let part = 0;
    let buffer: string[] = [];
    let bytes = 0;

    const flush = async () => {
      const path = await this.getPartitionPath(part);
      // @ts-ignore
      await this.app.vault.adapter.write(path, buffer.join("\n") + "\n");
      part++;
      buffer = [];
      bytes = 0;
    };

    for (const line of lines) {
      const additional = line.length + 1; // include newline
      if (bytes + additional > IndexPersistenceManager.MAX_BYTES && buffer.length > 0) {
        await flush();
      }
      buffer.push(line);
      bytes += additional;
    }

    if (buffer.length > 0) {
      await flush();
    }

    // Remove any tail partitions beyond the last written one
    await this.cleanupExtraPartitions(part);
  }

  /**
   * Remove partition files beyond the specified index
   */
  private async cleanupExtraPartitions(startIndex: number): Promise<void> {
    for (let i = startIndex; i < IndexPersistenceManager.MAX_PARTITIONS; i++) {
      const p = await this.getPartitionPath(i);
      // @ts-ignore
      if (await this.app.vault.adapter.exists(p)) {
        try {
          // @ts-ignore
          await this.app.vault.adapter.remove(p);
        } catch {
          // ignore
        }
      } else {
        break;
      }
    }
  }

  /**
   * Check if any index files exist
   */
  async hasIndex(): Promise<boolean> {
    const paths = await this.getExistingPartitionPaths();
    return paths.length > 0;
  }

  /**
   * Clear all index files
   */
  async clearIndex(): Promise<void> {
    const paths = await this.getExistingPartitionPaths();
    for (const path of paths) {
      try {
        // @ts-ignore
        await this.app.vault.adapter.remove(path);
      } catch {
        // ignore
      }
    }
    logInfo("IndexPersistenceManager: Cleared all index files");
  }
}
