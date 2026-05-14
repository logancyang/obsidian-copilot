// Reason: explicit import from the `buffer` npm polyfill (a browser-compatible
// drop-in, not a runtime use of Node's built-in). Mobile Obsidian's WebView has
// no Node globals, so bare `Buffer` throws "Can't find variable: Buffer" on iOS
// WebKit. esbuild bundles this polyfill into main.js so the same code path
// works on both desktop and mobile.
// eslint-disable-next-line import/no-nodejs-modules
import { Buffer } from "buffer";

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
