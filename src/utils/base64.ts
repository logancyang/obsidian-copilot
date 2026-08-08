// The trailing slash resolves the browser-compatible npm package instead of Node's built-in.
import { Buffer } from "buffer/";

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
