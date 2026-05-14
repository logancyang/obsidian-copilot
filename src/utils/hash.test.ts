import { md5, sha256 } from "./hash";

// Test vectors below are standard RFC 1321 / FIPS 180-4 reference values and
// match what `crypto-js`'s `MD5(str).toString()` / `SHA256(str).toString()`
// produced for the same UTF-8-encoded inputs. Preserving these byte-for-byte
// keeps existing on-disk cache keys (PDF cache, file cache, project cache,
// search index doc hashes) valid across the crypto-js removal.

describe("md5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
    ["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
  ])("md5(%j) = %s", (input, expected) => {
    expect(md5(input)).toBe(expected);
  });

  it("handles UTF-8 multibyte input", () => {
    // crypto-js encodes JS strings as UTF-8 before hashing; "café" → 63 61 66 c3 a9.
    expect(md5("café")).toBe("07117fe4a1ebd544965dc19573183da2");
  });

  it("handles inputs across block boundaries (55, 56, 64, 119, 120 bytes)", () => {
    expect(md5("a".repeat(55))).toBe("ef1772b6dff9a122358552954ad0df65");
    expect(md5("a".repeat(56))).toBe("3b0c8ac703f828b04c6c197006d17218");
    expect(md5("a".repeat(64))).toBe("014842d480b571495a4a0363793f7367");
    expect(md5("a".repeat(119))).toBe("8a7bd0732ed6a28ce75f6dabc90e1613");
    expect(md5("a".repeat(120))).toBe("5f61c0ccad4cac44c75ff505e1f1e537");
  });
});

describe("sha256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "The quick brown fox jumps over the lazy dog",
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    ],
  ])("sha256(%j) = %s", (input, expected) => {
    expect(sha256(input)).toBe(expected);
  });

  it("handles UTF-8 multibyte input", () => {
    expect(sha256("café")).toBe("850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e");
  });

  it("handles inputs across block boundaries (55, 56, 64, 119, 120 bytes)", () => {
    expect(sha256("a".repeat(55))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"
    );
    expect(sha256("a".repeat(56))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"
    );
    expect(sha256("a".repeat(64))).toBe(
      "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"
    );
    expect(sha256("a".repeat(119))).toBe(
      "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb"
    );
    expect(sha256("a".repeat(120))).toBe(
      "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c"
    );
  });
});
