/**
 * Tracks progress during file indexing operations
 */
export class IndexingProgressTracker {
  private fileToChunkCount = new Map<string, number>();
  private fileToTotalChunks = new Map<string, number>();
  private completedFiles = new Set<string>();
  private totalFiles: number;

  constructor(totalFiles: number) {
    this.totalFiles = totalFiles;
  }

  /**
   * Initialize tracking for a file with its total chunk count
   */
  initializeFile(filePath: string, totalChunks: number): void {
    this.fileToChunkCount.set(filePath, 0);
    this.fileToTotalChunks.set(filePath, totalChunks);
  }

  /**
   * Record that a chunk has been processed for a file
   */
  recordChunkProcessed(filePath: string): void {
    const current = (this.fileToChunkCount.get(filePath) ?? 0) + 1;
    this.fileToChunkCount.set(filePath, current);

    const total = this.fileToTotalChunks.get(filePath);
    if (total && current === total) {
      this.completedFiles.add(filePath);
    }
  }

  /**
   * Get the number of fully completed files
   */
  get completedCount(): number {
    return this.completedFiles.size;
  }

  /**
   * Get the total number of files being tracked
   */
  get total(): number {
    return this.totalFiles;
  }

  /**
   * Check if a specific file has been fully processed
   */
  isFileComplete(filePath: string): boolean {
    return this.completedFiles.has(filePath);
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.fileToChunkCount.clear();
    this.fileToTotalChunks.clear();
    this.completedFiles.clear();
  }
}
