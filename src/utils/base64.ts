/**
 * Native base64 ↔ ArrayBuffer conversion. Works on both desktop (Electron)
 * and mobile (WebView) — no Node Buffer polyfill required since both
 * environments expose `atob`/`btoa`.
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Build the binary string in chunks to avoid blowing the call stack on
  // large inputs (String.fromCharCode(...bytes) fails on multi-MB buffers).
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
