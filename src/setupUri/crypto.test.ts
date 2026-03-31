/**
 * Tests for Setup URI encryption/decryption primitives.
 *
 * Uses the real Node.js Web Crypto API for round-trip tests to verify
 * actual cryptographic correctness (not just mock wiring).
 *
 * PBKDF2 with 600K iterations is slow (~1-2s per call), so real
 * encrypt/decrypt is limited to 2 tests. Error path tests use
 * hand-crafted binary payloads to avoid PBKDF2 overhead.
 */

// Reason: jest-environment-jsdom does not expose crypto.subtle.
// Inject Node's Web Crypto before any module-level code runs.
import { Buffer } from "buffer";
import { webcrypto } from "node:crypto";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  writable: true,
  configurable: true,
});

import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  SetupUriDecryptionError,
  assertSetupUriPassphrase,
  MIN_SETUP_URI_PASSPHRASE_LENGTH,
} from "./crypto";

// ---------------------------------------------------------------------------
// Constants mirrored from crypto.ts (not exported, so duplicated for tests)
// ---------------------------------------------------------------------------
const PAYLOAD_VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const HEADER_LENGTH = 1 + 4 + SALT_LENGTH + IV_LENGTH; // 33

/** Write a 32-bit unsigned integer in little-endian. */
function writeUint32LE(value: number): Uint8Array {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return new Uint8Array(buf);
}

/** Encode bytes to base64url (RFC 4648 §5). */
function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Build a fake encrypted payload with a custom header.
 * The ciphertext portion is garbage (won't decrypt), but header parsing
 * is tested before decryption is attempted.
 */
function buildFakePayload(opts: {
  version?: number;
  iterations?: number;
  ciphertextLength?: number;
}): string {
  const version = opts.version ?? PAYLOAD_VERSION;
  const iterations = opts.iterations ?? 600_000;
  const ciphertextLen = opts.ciphertextLength ?? 64;

  const payload = new Uint8Array(HEADER_LENGTH + ciphertextLen);
  payload[0] = version;
  payload.set(writeUint32LE(iterations), 1);
  // salt and iv: leave as zeros (fine for header-parsing tests)
  // ciphertext: random-ish bytes so AES-GCM will fail with auth error
  for (let i = HEADER_LENGTH; i < payload.length; i++) {
    payload[i] = i & 0xff;
  }
  return toBase64url(payload);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("crypto.ts", () => {
  // -------------------------------------------------------------------------
  // Real encrypt/decrypt (uses PBKDF2 — slow, limited to 2 tests)
  // -------------------------------------------------------------------------
  describe("encryptWithPassphrase / decryptWithPassphrase round-trip", () => {
    it("should round-trip plaintext including UTF-8 characters", async () => {
      const plaintext = JSON.stringify({
        msg: "Hello 你好 🌍",
        nested: { arr: [1, 2, 3] },
      });
      const passphrase = "test-passphrase-12345";

      const encrypted = await encryptWithPassphrase(plaintext, passphrase);
      const decrypted = await decryptWithPassphrase(encrypted, passphrase);

      expect(decrypted).toBe(plaintext);
    }, 30_000); // generous timeout for PBKDF2

    it("should throw reason='wrong_passphrase' for incorrect passphrase", async () => {
      const encrypted = await encryptWithPassphrase("secret data", "correct-password");

      await expect(decryptWithPassphrase(encrypted, "wrong-password")).rejects.toThrow(
        expect.objectContaining({
          name: "SetupUriDecryptionError",
          reason: "wrong_passphrase",
        })
      );
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Header/format validation (no PBKDF2, fast)
  // -------------------------------------------------------------------------
  describe("decryptWithPassphrase format validation", () => {
    it.each([
      {
        name: "invalid base64url characters",
        encoded: "!!!not-valid-base64!!!",
        reason: "corrupted",
        msgSubstr: "not valid base64url",
      },
      {
        name: "truncated payload (too short)",
        encoded: toBase64url(new Uint8Array(10)),
        reason: "corrupted",
        msgSubstr: "truncated",
      },
      {
        name: "unsupported version byte (99)",
        encoded: buildFakePayload({ version: 99 }),
        reason: "unsupported_version",
        msgSubstr: "Unsupported",
      },
      {
        name: "iterations below minimum (1000)",
        encoded: buildFakePayload({ iterations: 1_000 }),
        reason: "corrupted",
        msgSubstr: "iteration count",
      },
      {
        name: "iterations above maximum (3M)",
        encoded: buildFakePayload({ iterations: 3_000_000 }),
        reason: "corrupted",
        msgSubstr: "iteration count",
      },
    ])("should throw reason='$reason' for $name", async ({ encoded, reason, msgSubstr }) => {
      await expect(decryptWithPassphrase(encoded, "any-pass")).rejects.toThrow(
        expect.objectContaining({
          name: "SetupUriDecryptionError",
          reason,
        })
      );

      try {
        await decryptWithPassphrase(encoded, "any-pass");
      } catch (err) {
        expect((err as Error).message).toContain(msgSubstr);
      }
    });

    it("should throw reason='corrupted' for payload exceeding 10MB", async () => {
      // Reason: build a payload just over the size limit.
      // Header (33) + ciphertext must exceed 10MB after base64url decode.
      const oversizedCiphertextLen = 10 * 1024 * 1024;
      const encoded = buildFakePayload({ ciphertextLength: oversizedCiphertextLen });

      await expect(decryptWithPassphrase(encoded, "any-pass")).rejects.toThrow(
        expect.objectContaining({
          name: "SetupUriDecryptionError",
          reason: "corrupted",
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // SetupUriDecryptionError class
  // -------------------------------------------------------------------------
  describe("SetupUriDecryptionError", () => {
    it("should be an Error with correct name and reason", () => {
      const err = new SetupUriDecryptionError("wrong_passphrase", "test message");

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("SetupUriDecryptionError");
      expect(err.reason).toBe("wrong_passphrase");
      expect(err.message).toBe("test message");
    });
  });

  // -------------------------------------------------------------------------
  // Passphrase policy enforcement
  // -------------------------------------------------------------------------
  describe("assertSetupUriPassphrase", () => {
    it("should throw for passphrases shorter than minimum length", () => {
      expect(() => assertSetupUriPassphrase("short")).toThrow(
        `Password must be at least ${MIN_SETUP_URI_PASSPHRASE_LENGTH} characters.`
      );
    });

    it("should not throw for passphrases at or above minimum length", () => {
      expect(() =>
        assertSetupUriPassphrase("a".repeat(MIN_SETUP_URI_PASSPHRASE_LENGTH))
      ).not.toThrow();
      expect(() =>
        assertSetupUriPassphrase("a-very-long-passphrase-that-exceeds-minimum")
      ).not.toThrow();
    });
  });

  describe("encryptWithPassphrase passphrase enforcement", () => {
    it("should reject short passphrases before encryption", async () => {
      await expect(encryptWithPassphrase("data", "short")).rejects.toThrow(/at least/);
    });
  });
});
