import "web-streams-polyfill/dist/polyfill.min.js";
import { webcrypto } from "crypto";
import { TextEncoder, TextDecoder } from "util";

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

// jsdom provides no SubtleCrypto on some Node versions and only a partial one on
// others (Node 22's jsdom lacks subtle.generateKey), so probe for the actual
// method we need and swap in Node's complete WebCrypto when it's missing. Bare
// `crypto` resolves to `window.crypto` under jsdom, so define it there.
if (typeof window.crypto?.subtle?.generateKey !== "function") {
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
