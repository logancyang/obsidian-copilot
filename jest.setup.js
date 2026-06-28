import "web-streams-polyfill/dist/polyfill.min.js";
import { webcrypto } from "crypto";
import { TextEncoder, TextDecoder } from "util";

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

// jsdom doesn't provide WebCrypto's SubtleCrypto; expose Node's so code that
// verifies signatures / encrypts (entitlement tokens, encryptionService) runs.
// Bare `crypto` resolves to `window.crypto` under jsdom, so define it there.
if (!window.crypto?.subtle) {
  Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
}

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
