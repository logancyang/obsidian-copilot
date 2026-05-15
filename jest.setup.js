import "web-streams-polyfill/dist/polyfill.min.js";
import { TextEncoder, TextDecoder } from "util";
import { webcrypto } from "crypto";

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

// jsdom 20 ships a Web Crypto stub without `randomUUID`; backfill from Node so
// production code that uses `crypto.randomUUID()` works in tests too.
 
if (
  typeof window.crypto === "undefined" ||
  typeof window.crypto.randomUUID !== "function"
) {
  // eslint-disable-next-line obsidianmd/no-global-this
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
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
