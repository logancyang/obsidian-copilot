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

// Polyfill Obsidian's DOM creation helpers. Obsidian installs `createEl` and
// friends on every window and on `Node.prototype`; jsdom has neither, so plugin
// code that builds elements through them would throw under test.
function applyDomElementInfo(el, info) {
  if (info.cls) {
    el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  }
  if (info.text != null) {
    if (info.text instanceof Node) {
      el.replaceChildren(info.text);
    } else {
      el.textContent = String(info.text);
    }
  }
  for (const [name, value] of Object.entries(info.attr ?? {})) {
    if (value === null) {
      el.removeAttribute(name);
    } else {
      el.setAttribute(name, String(value));
    }
  }
  for (const key of ["title", "value", "type", "placeholder", "href"]) {
    if (info[key] !== undefined) {
      el[key] = info[key];
    }
  }
}

function toDomElementInfo(info) {
  return typeof info === "string" ? { cls: info } : { ...info };
}

if (typeof window.createEl !== "function") {
  window.createEl = function (tag, info, callback) {
    const options = toDomElementInfo(info);
    const el = window.document.createElement(tag);
    applyDomElementInfo(el, options);
    // Obsidian runs the callback before attaching, so callers can finish
    // building the element without the parent seeing a half-built child.
    callback?.(el);
    if (options.parent) {
      if (options.prepend) {
        options.parent.insertBefore(el, options.parent.firstChild);
      } else {
        options.parent.appendChild(el);
      }
    }
    return el;
  };
  window.createDiv = (info, callback) => window.createEl("div", info, callback);
  window.createSpan = (info, callback) => window.createEl("span", info, callback);
  window.createFragment = (callback) => {
    const fragment = window.document.createDocumentFragment();
    callback?.(fragment);
    return fragment;
  };
}
if (typeof Node !== "undefined" && typeof Node.prototype.createEl !== "function") {
  Node.prototype.createEl = function (tag, info, callback) {
    return window.createEl(tag, { ...toDomElementInfo(info), parent: this }, callback);
  };
  Node.prototype.createDiv = function (info, callback) {
    return this.createEl("div", info, callback);
  };
  Node.prototype.createSpan = function (info, callback) {
    return this.createEl("span", info, callback);
  };
}

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

// Polyfill the Obsidian `HTMLElement` augmentations that plugin code reaches for
// when building chrome by hand, so those paths are exercisable under jsdom.
if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.addClass !== "function") {
  HTMLElement.prototype.addClass = function (...classes) {
    this.classList.add(...classes);
  };
}
if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.setText !== "function") {
  HTMLElement.prototype.setText = function (text) {
    this.textContent = text;
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
