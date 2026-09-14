/**
 * Cuts text and bytes to a byte budget on UTF-8 character boundaries: the head
 * or tail of an in-memory string, the tail of an open file, and the banner that
 * marks a shortened log. Nothing here knows what a budget is for — the caller
 * decides how much room a slice gets and what to do when it falls short.
 */

import { formatBytes } from "@/utils/formatBytes";

/**
 * Room given back out of a tail for the banner prepended to it. Taking this off
 * the tail is what stops a slice cut to exactly the budget from crossing it the
 * moment the banner goes on. Only a tail pays it — a log that fits whole
 * carries no banner and keeps every byte it has.
 */
export const TRUNCATION_NOTE_RESERVE_BYTES = 256;
/** A tail smaller than this is too short to diagnose anything, so skip instead. */
export const MIN_LOG_TAIL_BYTES = 64 * 1024;

/**
 * Byte-accurate tail of an in-memory log, mirroring what `readTailFrom` does
 * for a file so both sources obey the same budget. Slicing by bytes rather than
 * characters matters: note contents are often non-ASCII, where one character
 * costs up to four bytes and a character-based cap would blow the budget.
 */
export function tailOfText(text: string, maxBytes: number): { text: string; totalBytes: number } {
  const encoded = encodeText(text);
  if (encoded.length <= maxBytes) return { text, totalBytes: encoded.length };
  return {
    text: decodeTail(encoded.subarray(encoded.length - maxBytes)),
    totalBytes: encoded.length,
  };
}

/**
 * Decode bytes whose start is an arbitrary cut through a UTF-8 stream. Dropping
 * the leading continuation bytes costs at most three bytes of log and can only
 * shorten the slice; keeping them would decode the back half of a character into
 * a replacement glyph, and reaching backwards for the character's start would
 * push the slice past the budget its caller was promised.
 */
export function decodeTail(bytes: Uint8Array): string {
  let start = 0;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return new TextDecoder().decode(bytes.subarray(start));
}

/**
 * Prepend the banner that tells a reader what follows is only the newest part
 * of a shortened log. It names the original size and never the kept one: the
 * kept text is redacted, and redaction's rewrites can carry it past the
 * original, which would read as more of the log than exists.
 *
 * Worst case the banner is 91 bytes of fixed text plus the size, which
 * `formatBytes` prints in under 20 characters for any safe integer — well
 * inside `TRUNCATION_NOTE_RESERVE_BYTES`.
 *
 * @param whole The complete entries the banner sits above; the caller has
 *   already dropped the tail's cut-open first line.
 * @param totalBytes Size of the whole log the entries were kept from.
 */
export function withTruncationNote(whole: string, totalBytes: number): string {
  return (
    "… earlier entries omitted: only the newest entries of the original " +
    `${formatBytes(totalBytes)} log are included …\n${whole}`
  );
}

/**
 * Byte-accurate head of a string, cut on a UTF-8 character boundary: a note is
 * often non-ASCII, and a naive byte slice would leave half a character that
 * decodes to a replacement glyph.
 */
export function headOfText(text: string, maxBytes: number): { text: string; totalBytes: number } {
  const encoded = encodeText(text);
  if (encoded.length <= maxBytes) return { text, totalBytes: encoded.length };
  // UTF-8 continuation bytes are 0b10xxxxxx; back the cut off until it lands on
  // a leading byte so only whole characters survive.
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

/**
 * The subset of an open file handle `readTailFrom` needs, so the tail logic can
 * be exercised without a real filesystem.
 */
export interface TailReadable {
  stat: () => Promise<{ size: number }>;
  read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) => Promise<{ bytesRead: number }>;
}

/**
 * Read at most `maxBytes` from the end of an open file, positionally, so only
 * the newest part of a large log is ever loaded. The loop guards against a
 * short read, which `read` may return at any time, and only what was read is
 * decoded: decoding the whole buffer would turn its unfilled remainder into NUL
 * characters inside a log the user is told is genuine.
 *
 * @param handle Open file to read from; the caller owns closing it.
 * @param maxBytes Ceiling on how much of the tail to keep.
 */
export async function readTailFrom(
  handle: TailReadable,
  maxBytes: number
): Promise<{ text: string; totalBytes: number }> {
  const { size } = await handle.stat();
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return { text: "", totalBytes: size };

  const buffer = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled);
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  // Reading nothing means the file shrank past `start` between the `stat` and
  // the read. Reporting 0 rather than the stale `size` is what was actually
  // read, so the caller lists the source as empty instead of packing a
  // truncation banner over nothing.
  return { text: decodeTail(buffer.subarray(0, filled)), totalBytes: filled === 0 ? 0 : size };
}
