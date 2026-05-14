/**
 * Pure-JS MD5 and SHA-256 producing lowercase-hex digests that match what
 * `crypto-js`'s `MD5(str).toString()` / `SHA256(str).toString()` produced.
 *
 * Used for cache keys and content fingerprints — not for security. Pure JS so
 * it stays available across Obsidian's desktop (Electron) and mobile (WebView)
 * runtimes, where `node:crypto` is unavailable and `crypto.subtle.digest` is
 * async-only.
 *
 * Inputs are interpreted as UTF-8 (matching crypto-js's default `Utf8.parse`).
 */

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >>> 4] + HEX[bytes[i] & 0xf];
  }
  return out;
}

// ---------- MD5 (RFC 1321) ----------

const MD5_T = new Int32Array([
  -0x28955b88, -0x173848aa, 0x242070db, -0x3e423112, -0x0a83f051, 0x4787c62a, -0x57cfb9ed,
  -0x02b96aff, 0x698098d8, -0x74bb0851, -0x0000a44f, -0x76a32842, 0x6b901122, -0x02678e6d,
  -0x5986bc72, 0x49b40821, -0x09e1da9e, -0x3fbf4cc0, 0x265e5a51, -0x16493856, -0x29d0efa3,
  0x02441453, -0x275e197f, -0x182c0438, 0x21e1cde6, -0x3cc8f82a, -0x0b2af279, 0x455a14ed,
  -0x561c16fb, -0x03105c08, 0x676f02d9, -0x72d5b376, -0x0005c6be, -0x788e097f, 0x6d9d6122,
  -0x021ac7f4, -0x5b4115bc, 0x4bdecfa9, -0x0944b4a0, -0x41404390, 0x289b7ec6, -0x155ed806,
  -0x2b10cf7b, 0x04881d05, -0x262b2fc7, -0x1924661b, 0x1fa27cf8, -0x3b53a99b, -0x0bd6ddbc,
  0x432aff97, -0x546bdc59, -0x036c5fc7, 0x655b59c3, -0x70f3336e, -0x00100b83, -0x7a7ba22f,
  0x6fa87e4f, -0x01d31920, -0x5cfebcec, 0x4e0811a1, -0x08ac817e, -0x42c50dcb, 0x2ad7d2bb,
  -0x14792c6f,
]);

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function rotl32(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

export function md5(input: string): string {
  const msg = new TextEncoder().encode(input);
  const len = msg.length;
  // Pad to a multiple of 64 with at least 9 trailing bytes (0x80 + 8-byte length).
  const paddedLen = (((len + 8) >>> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  // Length in bits, little-endian, 64-bit. JS numbers handle len * 8 up to ~2^50.
  const bitLenLow = (len * 8) >>> 0;
  const bitLenHigh = Math.floor(len / 0x20000000);
  dv.setUint32(paddedLen - 8, bitLenLow, true);
  dv.setUint32(paddedLen - 4, bitLenHigh, true);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;

  const M = new Int32Array(16);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 0xf;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 0xf;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 0xf;
      }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl32((a + f + MD5_T[i] + M[g]) | 0, MD5_S[i])) | 0;
      a = tmp;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  // MD5 digest: state words in little-endian byte order.
  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setInt32(0, a0, true);
  outDv.setInt32(4, b0, true);
  outDv.setInt32(8, c0, true);
  outDv.setInt32(12, d0, true);
  return bytesToHex(out);
}

// ---------- SHA-256 (FIPS 180-4) ----------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(input: string): string {
  const msg = new TextEncoder().encode(input);
  const len = msg.length;
  const paddedLen = (((len + 8) >>> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  // Length in bits, big-endian, 64-bit. JS numbers handle len * 8 up to ~2^50.
  const bitLenLow = (len * 8) >>> 0;
  const bitLenHigh = Math.floor(len / 0x20000000);
  dv.setUint32(paddedLen - 8, bitLenHigh, false);
  dv.setUint32(paddedLen - 4, bitLenLow, false);

  let h0 = 0x6a09e667 | 0;
  let h1 = 0xbb67ae85 | 0;
  let h2 = 0x3c6ef372 | 0;
  let h3 = 0xa54ff53a | 0;
  let h4 = 0x510e527f | 0;
  let h5 = 0x9b05688c | 0;
  let h6 = 0x1f83d9ab | 0;
  let h7 = 0x5be0cd19 | 0;

  const W = new Int32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15];
      const w2 = W[i - 2];
      const s0 = rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) | 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setInt32(0, h0, false);
  outDv.setInt32(4, h1, false);
  outDv.setInt32(8, h2, false);
  outDv.setInt32(12, h3, false);
  outDv.setInt32(16, h4, false);
  outDv.setInt32(20, h5, false);
  outDv.setInt32(24, h6, false);
  outDv.setInt32(28, h7, false);
  return bytesToHex(out);
}
