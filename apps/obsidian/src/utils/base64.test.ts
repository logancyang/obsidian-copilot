import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/94";

describe("base64", () => {
  describe("arrayBufferToBase64()", () => {
    it("encodes UTF-8 bytes as padded standard base64", () => {
      const bytes = new TextEncoder().encode("Copilot 🚀");
      expect(arrayBufferToBase64(bytes.buffer as ArrayBuffer)).toBe("Q29waWxvdCDwn5qA");
      expect(arrayBufferToBase64(new Uint8Array([1]).buffer)).toBe("AQ==");
    });

    it("encodes an empty buffer as an empty string", () => {
      expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
    });

    it(`encodes a megabyte-scale attachment without exceeding the argument limit (${ISSUE})`, () => {
      const bytes = new Uint8Array(1024 * 1024 + 7);
      bytes.forEach((_, index) => (bytes[index] = index % 251));
      const encoded = arrayBufferToBase64(bytes.buffer);
      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
      expect(arrayBufferToBase64(base64ToArrayBuffer(encoded))).toBe(encoded);
    });
  });

  describe("base64ToArrayBuffer()", () => {
    it("decodes padded and unpadded base64 to the original bytes", () => {
      expect(new Uint8Array(base64ToArrayBuffer("AAECA3+A/w=="))).toEqual(
        new Uint8Array([0, 1, 2, 3, 127, 128, 255])
      );
      expect(new Uint8Array(base64ToArrayBuffer("AAECA3+A/w"))).toEqual(
        new Uint8Array([0, 1, 2, 3, 127, 128, 255])
      );
    });

    it(`decodes without a global Buffer, as in the mobile WebView (${ISSUE})`, () => {
      // eslint-disable-next-line obsidianmd/no-global-this -- jsdom test needs to mutate the actual global runtime, not a per-window scope
      const g = globalThis as { Buffer?: unknown };
      const originalBuffer = g.Buffer;
      try {
        delete g.Buffer;
        const bytes = new Uint8Array([10, 20, 30, 40]).buffer;
        expect(new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes)))).toEqual(
          new Uint8Array(bytes)
        );
      } finally {
        g.Buffer = originalBuffer;
      }
    });
  });
});
