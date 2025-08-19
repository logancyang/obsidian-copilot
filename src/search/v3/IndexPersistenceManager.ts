import { App } from "obsidian";
import { getSettings } from "@/settings/model";
import { logInfo, logWarn } from "@/logger";

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

  // Memory safety thresholds for INCREMENTAL memory usage during indexing
  private static readonly INCREMENTAL_MEMORY_WARNING_THRESHOLD_MB = 500; // Warn if indexing uses more than 500MB

  private baselineMemoryMB: number | null = null;

  // Processing batch constants
  private static readonly WRITE_BATCH_SIZE = 1000; // Records per batch for writeRecords
  private static readonly UPDATE_BATCH_SIZE = 500; // Records per batch for updateFileRecords
  private static readonly MEMORY_CHECK_INTERVAL = 5; // Check memory every N batches
  private static readonly YIELD_INTERVAL = 4; // Yield control every N batches

  constructor(private app: App) {}

  /**
   * Get estimated memory usage of the current process (basic approximation)
   */
  private getMemoryUsageMB(): number {
    if (typeof process !== "undefined" && process.memoryUsage) {
      const usage = process.memoryUsage();
      return usage.heapUsed / (1024 * 1024);
    }

    // Browser environments: use performance.memory if available
    if (typeof performance !== "undefined" && "memory" in performance) {
      const memory = (performance as any).memory;
      return memory.usedJSHeapSize / (1024 * 1024);
    }

    // No memory monitoring available - use conservative approach
    logWarn("Memory monitoring unavailable - using conservative processing limits");
    return 100; // Assume moderate usage to enable basic throttling
  }

  /**
   * Set baseline memory usage at the start of indexing operations
   */
  private setBaselineMemory(): void {
    this.baselineMemoryMB = this.getMemoryUsageMB();
    logInfo(`IndexPersistence: Baseline memory set to ${this.baselineMemoryMB.toFixed(1)}MB`);
  }

  /**
   * Check if current incremental memory usage is within safe limits
   */
  private checkMemorySafety(operation: string): void {
    const currentMemoryMB = this.getMemoryUsageMB();

    if (this.baselineMemoryMB === null) {
      // If baseline not set, set it now and log absolute usage
      this.setBaselineMemory();
      logInfo(
        `Memory usage: ${currentMemoryMB.toFixed(1)}MB during ${operation} (baseline established)`
      );
      return;
    }

    const incrementalMemoryMB = currentMemoryMB - this.baselineMemoryMB;

    // Always log incremental memory usage during indexing operations for debugging
    logInfo(
      `Incremental memory usage: +${incrementalMemoryMB.toFixed(1)}MB (${currentMemoryMB.toFixed(1)}MB total) during ${operation}`
    );

    if (incrementalMemoryMB > IndexPersistenceManager.INCREMENTAL_MEMORY_WARNING_THRESHOLD_MB) {
      logWarn(
        `High incremental memory usage detected (+${incrementalMemoryMB.toFixed(1)}MB) during ${operation}`
      );
    }
  }

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
   * Write records to partitioned JSONL files with batch processing to avoid OOM
   */
  async writeRecords(records: JsonlChunkRecord[]): Promise<void> {
    this.checkMemorySafety("writeRecords start");

    // Process records in batches to avoid memory exhaustion
    const BATCH_SIZE = IndexPersistenceManager.WRITE_BATCH_SIZE;
    const lines: string[] = [];

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const batchLines = batch.map((r) => JSON.stringify(r));
      lines.push(...batchLines);

      // Yield control and check memory to prevent blocking UI and OOM
      if (i % (BATCH_SIZE * IndexPersistenceManager.YIELD_INTERVAL) === 0) {
        this.checkMemorySafety("writeRecords batch processing");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

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
   * Update records for a specific file without loading the entire index into memory
   * This processes partitions in a streaming fashion to prevent OOM
   */
  async updateFileRecords(filePath: string, newRecords: JsonlChunkRecord[]): Promise<void> {
    this.checkMemorySafety("updateFileRecords start");

    const paths = await this.getExistingPartitionPaths();
    if (paths.length === 0) {
      // No existing index, just write the new records
      await this.writeRecords(newRecords);
      return;
    }

    // Create temporary partitions for the updated index
    const tempPartitions: string[] = [];
    let currentBuffer: string[] = [];
    let currentBytes = 0;
    let partitionIndex = 0;

    // Helper function to flush current buffer to a temporary partition
    const flushBuffer = async () => {
      if (currentBuffer.length === 0) return;

      const tempPath = `${await this.getPartitionPath(0)}.tmp.${partitionIndex}`;
      const content = currentBuffer.join("\n") + "\n";

      // @ts-ignore
      await this.app.vault.adapter.write(tempPath, content);
      tempPartitions.push(tempPath);

      currentBuffer = [];
      currentBytes = 0;
      partitionIndex++;
    };

    // Helper function to add records to buffer
    const addToBuffer = async (records: JsonlChunkRecord[]) => {
      for (const record of records) {
        const line = JSON.stringify(record);
        const lineBytes = line.length + 1; // +1 for newline

        // Check if we need to flush buffer before adding
        if (
          currentBytes + lineBytes > IndexPersistenceManager.MAX_BYTES &&
          currentBuffer.length > 0
        ) {
          await flushBuffer();
        }

        currentBuffer.push(line);
        currentBytes += lineBytes;
      }
    };

    try {
      // Process existing partitions one by one
      for (const path of paths) {
        try {
          // @ts-ignore
          const content = await this.app.vault.adapter.read(path);
          const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

          // Process lines in batches to avoid memory spikes
          const BATCH_SIZE = IndexPersistenceManager.UPDATE_BATCH_SIZE;
          for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            const batch = lines.slice(i, i + BATCH_SIZE);
            const validRecords: JsonlChunkRecord[] = [];

            for (const line of batch) {
              try {
                const record = JSON.parse(line) as JsonlChunkRecord;
                // Skip records for the file being updated
                if (record.path !== filePath) {
                  validRecords.push(record);
                }
              } catch (error) {
                logInfo(`IndexPersistenceManager: Skipping invalid record in ${path}: ${error}`);
              }
            }

            await addToBuffer(validRecords);

            // Yield control every few batches and check memory
            if (i % (BATCH_SIZE * IndexPersistenceManager.YIELD_INTERVAL) === 0) {
              this.checkMemorySafety("updateFileRecords processing");
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
        } catch (error) {
          logInfo(`IndexPersistenceManager: Failed to read partition ${path}: ${error}`);
        }
      }

      // Add new records for the file
      await addToBuffer(newRecords);

      // Flush any remaining records
      await flushBuffer();

      // Now atomically replace the old partitions with new ones
      await this.replacePartitionsFromTemp(tempPartitions);
    } finally {
      // Clean up temporary files
      for (const tempPath of tempPartitions) {
        try {
          // @ts-ignore
          await this.app.vault.adapter.remove(tempPath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  /**
   * Atomically replace old partitions with new ones from temporary files
   */
  private async replacePartitionsFromTemp(tempPartitions: string[]): Promise<void> {
    // First, clear existing partitions
    await this.cleanupExtraPartitions(0);

    // Then move temporary files to actual partition locations
    for (let i = 0; i < tempPartitions.length; i++) {
      const tempPath = tempPartitions[i];
      const finalPath = await this.getPartitionPath(i);

      try {
        // @ts-ignore
        const content = await this.app.vault.adapter.read(tempPath);
        // @ts-ignore
        await this.app.vault.adapter.write(finalPath, content);
      } catch (error) {
        logInfo(`IndexPersistenceManager: Failed to move temp partition ${i}: ${error}`);
        throw error; // This is critical, so we should throw
      }
    }
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
