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

// Polyfill Obsidian's element-construction helpers so tests exercise the same
// document-aware calls that run inside the plugin and its popout windows.
function installCreateElHelpers(prototype) {
  if (typeof prototype.createEl !== "function") {
    prototype.createEl = function (tag, options = {}) {
      const doc = this instanceof Document ? this : (this.ownerDocument ?? window.document);
      const element = doc.createElement(tag);
      if (options.cls) {
        const classes = Array.isArray(options.cls) ? options.cls : options.cls.split(" ");
        element.classList.add(...classes.filter(Boolean));
      }
      if (options.text !== undefined) element.textContent = String(options.text);
      for (const [name, value] of Object.entries(options.attr ?? {})) {
        element.setAttribute(name, String(value));
      }
      if (!(this instanceof Document)) this.appendChild(element);
      return element;
    };
  }
  if (typeof prototype.createDiv !== "function") {
    prototype.createDiv = function (options) {
      return this.createEl("div", options);
    };
  }
  if (typeof prototype.createSpan !== "function") {
    prototype.createSpan = function (options) {
      return this.createEl("span", options);
    };
  }
}

if (typeof Document !== "undefined") installCreateElHelpers(Document.prototype);
if (typeof HTMLElement !== "undefined") installCreateElHelpers(HTMLElement.prototype);

// Polyfill Obsidian's `HTMLElement.setCssProps` augmentation (sets one or more
// CSS custom properties) so plugin code that calls it — e.g. the autosizing
// `Textarea` — works under jsdom.
if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.setCssProps !== "function") {
  HTMLElement.prototype.setCssProps = function (props) {
    for (const [name, value] of Object.entries(props)) {
      this.style.setProperty(name, value);
    }
  };
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
