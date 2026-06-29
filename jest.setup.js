import "web-streams-polyfill/dist/polyfill.min.js";
import { TextEncoder, TextDecoder } from "util";

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

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

// Obsidian exposes `activeDocument` / `activeWindow` globals pointing at the
// focused popout's document/window. Under jsdom there's only one document, so
// alias them onto `window` (the jsdom global object) — plugin code that portals
// into `activeDocument.body` (e.g. the Radix tooltip) would otherwise throw
// `activeDocument is not defined`.
if (typeof window.activeDocument === "undefined") {
  window.activeDocument = window.document;
}
if (typeof window.activeWindow === "undefined") {
  window.activeWindow = window;
}
