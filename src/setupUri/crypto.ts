/**
 * Passphrase-based encryption for Setup URI payloads.
 *
 * Uses PBKDF2 key derivation + AES-256-GCM via the Web Crypto API,
 * ensuring cross-platform compatibility (desktop + mobile).
 *
 * Payload binary format (all concatenated):
 *   [1B version][4B iterations LE][16B salt][12B iv][...ciphertext+tag]
 *
 * The output is encoded as base64url (RFC 4648 §5) so it can be safely
 * embedded in URI query parameters without escaping issues.
 */

import { Buffer } from "buffer";
import { Inflate, deflate } from "pako";

// Reason: version byte allows future upgrades to KDF or cipher without
// breaking existing URIs — decoders check version before parsing.
const PAYLOAD_VERSION = 1;
const DEFAULT_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const HEADER_LENGTH = 1 + 4 + SALT_LENGTH + IV_LENGTH; // 33 bytes
const AAD = new TextEncoder().encode("copilot-setup:v1");

/** Assert WebCrypto is available before attempting crypto operations. */
function assertWebCryptoAvailable(): void {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Configuration export requires the WebCrypto API, which is not available in this environment."
    );
  }
}

/** Maximum accepted encrypted payload size (10 MB) to prevent DoS. */
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/** Maximum allowed decompressed plaintext size (50 MB) to prevent zip-bomb DoS. */
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Maximum allowed PBKDF2 iterations to prevent DoS via crafted payloads. */
const MAX_ITERATIONS = 2_000_000;

/** Minimum PBKDF2 iterations to prevent downgrade attacks. */
const MIN_ITERATIONS = 100_000;

/** Minimum required passphrase length (characters) for Setup URI encryption. */
export const MIN_SETUP_URI_PASSPHRASE_LENGTH = 8;

/**
 * Enforce the Setup URI passphrase policy.
 *
 * Reason: UI validates password length, but core helpers must enforce the same
 * policy so non-UI callers cannot generate weakly-protected payloads.
 *
 * @throws {Error} When passphrase does not meet the minimum length requirement.
 */
export function assertSetupUriPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_SETUP_URI_PASSPHRASE_LENGTH) {
    throw new Error(`Password must be at least ${MIN_SETUP_URI_PASSPHRASE_LENGTH} characters.`);
  }
}

// ---------------------------------------------------------------------------
// base64url helpers (RFC 4648 §5 — no +, /, or = padding)
// ---------------------------------------------------------------------------

/** Encode a Uint8Array to a base64url string (RFC 4648 §5, no padding). */
function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Regex matching valid base64url characters (RFC 4648 §5). */
const BASE64URL_RE = /^[A-Za-z0-9\-_]*$/;

/** Decode a base64url string back to a Uint8Array. */
function fromBase64url(b64url: string): Uint8Array {
  // Reason: Buffer.from(b64, "base64") silently ignores invalid chars.
  // Pre-validate to provide a clear "not valid base64url" error message.
  if (!BASE64URL_RE.test(b64url)) {
    throw new Error("Input is not valid base64url data.");
  }

  // Reason: in base64, every 4 encoded chars represent 3 bytes.
  // A remainder of 1 after mod-4 is structurally invalid — it cannot
  // encode a whole number of bytes.
  if (b64url.length % 4 === 1) {
    throw new Error("Input is not valid base64url data.");
  }

  // Restore standard base64 characters and padding
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive an AES-256-GCM key from a passphrase using PBKDF2. */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Write a 32-bit unsigned integer in little-endian into a Uint8Array. */
function writeUint32LE(value: number): Uint8Array {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return new Uint8Array(buf);
}

/** Read a 32-bit unsigned integer in little-endian from a Uint8Array. */
function readUint32LE(buf: Uint8Array, offset: number): number {
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).readUInt32LE(offset);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decompress with a hard output size limit to bound memory usage.
 *
 * Uses pako's streaming Inflate API with an `onData` callback that stops
 * accumulating chunks once the output exceeds `maxBytes`. Note: the CPU
 * work of decompressing the full stream is NOT aborted — only memory
 * allocation is capped. This is acceptable because the encrypted payload
 * is already limited to 10 MB (`MAX_PAYLOAD_BYTES`), which bounds the
 * compressed input size and therefore the CPU cost.
 *
 * @param compressed - Deflate-compressed bytes.
 * @param maxBytes - Maximum allowed output size in bytes.
 * @returns Decompressed bytes.
 * @throws {Error} If decompressed output exceeds `maxBytes` or inflate fails.
 */
function inflateWithLimit(compressed: Uint8Array, maxBytes: number): Uint8Array {
  let totalBytes = 0;
  let limitExceeded = false;
  const chunks: Uint8Array[] = [];

  const inflator = new Inflate();
  // Reason: pako catches exceptions thrown inside `onData` and stores them
  // in `inflator.err` rather than propagating — so throwing here would NOT
  // abort decompression. Use a flag to skip chunk accumulation instead,
  // which caps memory usage while the CPU still processes the full stream.
  inflator.onData = (chunk: Uint8Array) => {
    if (limitExceeded) return;
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      limitExceeded = true;
      return;
    }
    chunks.push(chunk);
  };

  inflator.push(compressed, true);

  if (limitExceeded) {
    throw new Error(`Decompressed payload exceeds limit (${maxBytes} bytes).`);
  }
  if (inflator.err) {
    throw new Error(inflator.msg || "Failed to decompress payload.");
  }

  // Reason: concatenate all chunks into a single Uint8Array for TextDecoder
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Encrypt a plaintext string with a user-supplied passphrase.
 *
 * The plaintext is first compressed with deflate to reduce URI size,
 * then encrypted with AES-256-GCM using a PBKDF2-derived key.
 *
 * @returns A base64url-encoded string suitable for embedding in a URI.
 */
export async function encryptWithPassphrase(
  plaintext: string,
  passphrase: string
): Promise<string> {
  assertSetupUriPassphrase(passphrase);
  assertWebCryptoAvailable();
  const compressed = deflate(new TextEncoder().encode(plaintext));

  // Reason: AES-GCM appends a 16-byte auth tag. Pre-flight the total payload
  // size before running expensive PBKDF2 key derivation.
  const estimatedPayload = HEADER_LENGTH + compressed.length + 16;
  if (estimatedPayload > MAX_PAYLOAD_BYTES) {
    throw new Error(
      "Configuration is too large to export (max 10 MB). " +
        "Consider removing unused model configurations to reduce size."
    );
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, compressed)
  );

  // Assemble: [version(1)][iterations(4)][salt(16)][iv(12)][ciphertext...]
  const payload = new Uint8Array(HEADER_LENGTH + ciphertext.length);
  payload[0] = PAYLOAD_VERSION;
  payload.set(writeUint32LE(DEFAULT_ITERATIONS), 1);
  payload.set(salt, 5);
  payload.set(iv, 5 + SALT_LENGTH);
  payload.set(ciphertext, HEADER_LENGTH);

  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(
      "Configuration is too large to export (max 10 MB). " +
        "Consider removing unused model configurations to reduce size."
    );
  }

  return toBase64url(payload);
}

/**
 * Decrypt a base64url-encoded payload with the given passphrase.
 *
 * @throws {SetupUriDecryptionError} with a user-friendly `reason` field.
 */
export async function decryptWithPassphrase(encoded: string, passphrase: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new SetupUriDecryptionError(
      "unsupported_environment",
      "Configuration import requires the WebCrypto API, which is not available in this environment."
    );
  }
  let raw: Uint8Array;
  try {
    // Reason: pre-check encoded length before decoding to avoid allocating
    // huge buffers from maliciously long strings. Base64 expands ~33%.
    const maxEncodedLength = Math.ceil((MAX_PAYLOAD_BYTES * 4) / 3);
    if (encoded.length > maxEncodedLength) {
      throw new SetupUriDecryptionError(
        "corrupted",
        "The payload exceeds the maximum allowed size."
      );
    }
    raw = fromBase64url(encoded);
  } catch (error) {
    // Reason: re-throw SetupUriDecryptionError as-is (e.g., oversized payload)
    // so callers get the correct diagnosis instead of a generic base64url error.
    if (error instanceof SetupUriDecryptionError) throw error;
    throw new SetupUriDecryptionError("corrupted", "The payload is not valid base64url data.");
  }

  if (raw.length > MAX_PAYLOAD_BYTES) {
    throw new SetupUriDecryptionError("corrupted", "The payload exceeds the maximum allowed size.");
  }

  if (raw.length < HEADER_LENGTH + 16) {
    // Reason: GCM tag alone is 16 bytes, so anything shorter is truncated.
    throw new SetupUriDecryptionError("corrupted", "The payload appears to be truncated.");
  }

  const version = raw[0];
  if (version !== PAYLOAD_VERSION) {
    throw new SetupUriDecryptionError(
      "unsupported_version",
      `Unsupported configuration file version: ${version}. Please update the Copilot plugin.`
    );
  }

  const iterations = readUint32LE(raw, 1);
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new SetupUriDecryptionError(
      "corrupted",
      `Invalid KDF iteration count (${iterations}). The payload may be corrupted.`
    );
  }

  const salt = raw.slice(5, 5 + SALT_LENGTH);
  const iv = raw.slice(5 + SALT_LENGTH, HEADER_LENGTH);
  const ciphertext = raw.slice(HEADER_LENGTH);

  let decrypted: ArrayBuffer;
  try {
    const key = await deriveKey(passphrase, salt, iterations);
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      ciphertext
    );
  } catch {
    // Reason: AES-GCM auth failure is indistinguishable from wrong key
    // vs corrupted payload, so we surface both possibilities to the user.
    throw new SetupUriDecryptionError(
      "wrong_passphrase",
      "Decryption failed. Wrong password or corrupted payload."
    );
  }

  try {
    const decompressed = inflateWithLimit(new Uint8Array(decrypted), MAX_DECOMPRESSED_BYTES);
    return new TextDecoder().decode(decompressed);
  } catch {
    throw new SetupUriDecryptionError(
      "corrupted",
      "Failed to decompress the settings data (corrupted or too large)."
    );
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type DecryptionErrorReason =
  | "wrong_passphrase"
  | "corrupted"
  | "unsupported_version"
  | "unsupported_environment";

/** Structured error for Setup URI decryption failures. */
export class SetupUriDecryptionError extends Error {
  constructor(
    public readonly reason: DecryptionErrorReason,
    message: string
  ) {
    super(message);
    this.name = "SetupUriDecryptionError";
  }
}
