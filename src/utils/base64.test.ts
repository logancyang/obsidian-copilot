import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64";

describe("base64 utils", () => {
  it("round-trips a small ArrayBuffer", () => {
    const original = new Uint8Array([0, 1, 2, 3, 127, 128, 255]).buffer;
    const encoded = arrayBufferToBase64(original);
    const decoded = base64ToArrayBuffer(encoded);
    expect(new Uint8Array(decoded)).toEqual(new Uint8Array(original));
  });

  it("matches a known base64 fixture", () => {
    const bytes = new TextEncoder().encode("Copilot 🚀");
    expect(arrayBufferToBase64(bytes.buffer as ArrayBuffer)).toBe("Q29waWxvdCDwn5qA");
  });

  it("works without relying on globalThis.Buffer (mobile WebView simulation)", () => {
    // eslint-disable-next-line obsidianmd/no-global-this -- jsdom test needs to mutate the actual global runtime, not a per-window scope
    const g = globalThis as { Buffer?: unknown };
    const originalBuffer = g.Buffer;
    try {
      delete g.Buffer;
      const bytes = new Uint8Array([10, 20, 30, 40]).buffer;
      const encoded = arrayBufferToBase64(bytes);
      const decoded = base64ToArrayBuffer(encoded);
      expect(new Uint8Array(decoded)).toEqual(new Uint8Array(bytes));
    } finally {
      if (originalBuffer !== undefined) {
        g.Buffer = originalBuffer;
      }
    }
  });
});
