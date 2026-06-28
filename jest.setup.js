/* eslint-disable obsidianmd/no-global-this -- test setup, not plugin runtime */
import "web-streams-polyfill/dist/polyfill.min.js";
import { webcrypto } from "crypto";
import { TextEncoder, TextDecoder } from "util";

if (typeof window !== "undefined") {
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
}

// jsdom ships no/partial WebCrypto (its subtle lacks generateKey/ECDSA). Force
// Node's complete WebCrypto onto every global a module-under-test might resolve
// `crypto` from. A bare `crypto` reference resolves to `globalThis.crypto`, which
// is NOT always the same binding as `window.crypto` inside jest's VM — so patch
// both. When `crypto` is a locked accessor, fall back to replacing `.subtle`.
function ensureWebCrypto(target) {
  if (!target || typeof target.crypto?.subtle?.generateKey === "function") return;
  try {
    Object.defineProperty(target, "crypto", {
      value: webcrypto,
      configurable: true,
      writable: true,
    });
  } catch {
    try {
      Object.defineProperty(target.crypto, "subtle", {
        value: webcrypto.subtle,
        configurable: true,
      });
    } catch {
      // Leave as-is; the crypto-dependent suites will surface the gap loudly.
    }
  }
}
ensureWebCrypto(globalThis);
if (typeof window !== "undefined") ensureWebCrypto(window);

// Polyfill Obsidian's Node.doc / Node.win augmentation so plugin code that
// reads `element.doc` / `element.win` works under jsdom.
if (typeof Node !== "undefined" && !Object.prototype.hasOwnProperty.call(Node.prototype, "doc")) {
  Object.defineProperty(Node.prototype, "doc", {
    get() {
      return this.ownerDocument ?? window.document;
    },
    configurable: true,
  });
}
if (typeof Node !== "undefined" && !Object.prototype.hasOwnProperty.call(Node.prototype, "win")) {
  Object.defineProperty(Node.prototype, "win", {
    get() {
      return this.ownerDocument?.defaultView ?? window;
    },
    configurable: true,
  });
}
