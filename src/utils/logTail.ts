import { formatBytes } from "@/utils/formatBytes";

export const TRUNCATION_NOTE_RESERVE_BYTES = 256;
export const MIN_LOG_TAIL_BYTES = 64 * 1024;

export function tailOfText(text: string, maxBytes: number): { text: string; totalBytes: number } {
  const encoded = encodeText(text);
  if (encoded.length <= maxBytes) return { text, totalBytes: encoded.length };
  return {
    text: decodeTail(encoded.subarray(encoded.length - maxBytes)),
    totalBytes: encoded.length,
  };
}

export function decodeTail(bytes: Uint8Array): string {
  let start = 0;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return new TextDecoder().decode(bytes.subarray(start));
}

export function withTruncationNote(whole: string, totalBytes: number): string {
  return (
    "… earlier entries omitted: only the newest entries of the original " +
    `${formatBytes(totalBytes)} log are included …\n${whole}`
  );
}

export function headOfText(text: string, maxBytes: number): { text: string; totalBytes: number } {
  const encoded = encodeText(text);
  if (encoded.length <= maxBytes) return { text, totalBytes: encoded.length };
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return { text: new TextDecoder().decode(encoded.subarray(0, end)), totalBytes: encoded.length };
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function byteLength(text: string): number {
  return encodeText(text).length;
}

export interface LogReadable {
  stat: () => Promise<{ size: number }>;
  read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) => Promise<{ bytesRead: number }>;
}

export async function readLogFrom(
  handle: LogReadable,
  maxBytes: number
): Promise<{ text: string; totalBytes: number }> {
  const { size } = await handle.stat();
  if (size > maxBytes || size === 0) return { text: "", totalBytes: size };

  const buffer = new Uint8Array(size);
  let filled = 0;
  while (filled < size) {
    const { bytesRead } = await handle.read(buffer, filled, size - filled, filled);
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  return {
    text: new TextDecoder().decode(buffer.subarray(0, filled)),
    totalBytes: filled === 0 ? 0 : size,
  };
}
