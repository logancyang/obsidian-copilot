import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";

/**
 * Manages memory budget for search operations
 */
export class MemoryManager {
  private static readonly DEFAULT_CANDIDATE_LIMIT = 500;
  private static readonly MB_TO_BYTES = 1024 * 1024;

  private bytesUsed: number = 0;
  private readonly maxBytes: number;
  private readonly candidateLimit: number;

  constructor() {
    const settings = getSettings();
    // Convert MB to bytes, with bounds checking
    const ramLimitMB = Math.min(1000, Math.max(20, settings.lexicalSearchRamLimit || 100));
    this.maxBytes = ramLimitMB * MemoryManager.MB_TO_BYTES;

    // Keep a reasonable candidate limit based on RAM available
    // Roughly 200KB average per document means ~500 docs for 100MB
    this.candidateLimit = Math.min(
      MemoryManager.DEFAULT_CANDIDATE_LIMIT,
      Math.floor(ramLimitMB * 5) // Approximately 5 docs per MB
    );
  }

  /**
   * Get the maximum memory budget in bytes
   */
  getMaxBytes(): number {
    return this.maxBytes;
  }

  /**
   * Get the maximum number of candidates to index
   */
  getCandidateLimit(): number {
    return this.candidateLimit;
  }

  /**
   * Get current memory usage in bytes
   */
  getBytesUsed(): number {
    return this.bytesUsed;
  }

  /**
   * Check if adding content would exceed memory budget
   * @param contentSize - Size of content in bytes
   * @returns True if content can be added without exceeding budget
   */
  canAddContent(contentSize: number): boolean {
    return this.bytesUsed + contentSize <= this.maxBytes;
  }

  /**
   * Add to memory usage tracking
   * @param bytes - Number of bytes to add
   */
  addBytes(bytes: number): void {
    this.bytesUsed += bytes;
  }

  /**
   * Reset memory tracking
   */
  reset(): void {
    const previousBytes = this.bytesUsed;
    this.bytesUsed = 0;
    logInfo(
      `MemoryManager: Reset memory tracking (was using ${previousBytes} bytes, max: ${this.maxBytes} bytes)`
    );
  }

  /**
   * Get memory usage percentage
   */
  getUsagePercent(): number {
    return Math.round((this.bytesUsed / this.maxBytes) * 100);
  }

  /**
   * Calculate size of a string in bytes
   * @param str - String to measure
   * @returns Size in bytes
   */
  static getByteSize(str: string): number {
    return new TextEncoder().encode(str).length;
  }
}
