import { digestsEqual, sha256Hex } from "@/remote/host/digest";

describe("digest", () => {
  describe("sha256Hex()", () => {
    it("returns the known SHA-256 of a string as lowercase hex", () => {
      expect(sha256Hex("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      );
    });
  });

  describe("digestsEqual()", () => {
    it("is true for identical digests", () => {
      expect(digestsEqual(sha256Hex("a"), sha256Hex("a"))).toBe(true);
    });

    it("is false for different digests of the same length", () => {
      expect(digestsEqual(sha256Hex("a"), sha256Hex("b"))).toBe(false);
    });

    it("is false, without throwing, for digests of different lengths", () => {
      expect(digestsEqual(sha256Hex("a"), "abcd")).toBe(false);
    });
  });
});
