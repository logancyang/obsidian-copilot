// Native btoa/atob replace the 26 KB Buffer polyfill so main.js stays under Obsidian Sync's
// 5 MB limit; chunking keeps multi-megabyte attachments within the engine's argument limit.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/94
const CHUNK_SIZE = 0x8000;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK_SIZE));
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return Uint8Array.from(window.atob(base64), (char) => char.charCodeAt(0)).buffer;
}
