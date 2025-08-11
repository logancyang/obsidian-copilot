import { logInfo } from "@/logger";
import { getPlatformValue } from "./platformUtils";

/**
 * Manages memory budget for search operations
 */
export class MemoryManager {
  private static readonly CONFIG = {
    MAX_BYTES: {
      MOBILE: 20 * 1024 * 1024, // 20MB
      DESKTOP: 100 * 1024 * 1024, // 100MB
    },
    CANDIDATE_LIMIT: {
      MOBILE: 300,
      DESKTOP: 500,
    },
  } as const;

  private bytesUsed: number = 0;
  private readonly maxBytes: number;
  private readonly candidateLimit: number;

  constructor() {
    this.maxBytes = getPlatformValue(
      MemoryManager.CONFIG.MAX_BYTES.MOBILE,
      MemoryManager.CONFIG.MAX_BYTES.DESKTOP
    );

    this.candidateLimit = getPlatformValue(
      MemoryManager.CONFIG.CANDIDATE_LIMIT.MOBILE,
      MemoryManager.CONFIG.CANDIDATE_LIMIT.DESKTOP
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
    this.bytesUsed = 0;
    logInfo(`MemoryManager: Reset memory tracking (max: ${this.maxBytes} bytes)`);
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
