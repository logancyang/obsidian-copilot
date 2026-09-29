import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";

export class MemoryManager {
  private static readonly MB_TO_BYTES = 1024 * 1024;

  private bytesUsed: number = 0;
  private readonly maxBytes: number;

  constructor() {
    const settings = getSettings();
    const ramLimitMB = Math.min(1000, Math.max(20, settings.lexicalSearchRamLimit || 100));
    this.maxBytes = ramLimitMB * MemoryManager.MB_TO_BYTES;
  }

  getMaxBytes(): number {
    return this.maxBytes;
  }

  getBytesUsed(): number {
    return this.bytesUsed;
  }

  canAddContent(contentSize: number): boolean {
    return this.bytesUsed + contentSize <= this.maxBytes;
  }

  addBytes(bytes: number): void {
    this.bytesUsed += bytes;
  }

  reset(): void {
    const previousBytes = this.bytesUsed;
    this.bytesUsed = 0;
    logInfo(
      `MemoryManager: Reset memory tracking (was using ${previousBytes} bytes, max: ${this.maxBytes} bytes)`
    );
  }

  getUsagePercent(): number {
    return Math.round((this.bytesUsed / this.maxBytes) * 100);
  }

  static getByteSize(str: string): number {
    return new TextEncoder().encode(str).length;
  }
}
