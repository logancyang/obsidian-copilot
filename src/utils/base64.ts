export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return new Uint8Array(Buffer.from(base64, "base64")).buffer;
}
