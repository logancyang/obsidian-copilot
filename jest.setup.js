import "web-streams-polyfill/dist/polyfill.min.js";
import { TextEncoder, TextDecoder } from "util";
import { Settings } from "luxon";

Settings.defaultLocale = "en-US";

const origNumberToLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (locales = "en-US", options) {
  return origNumberToLocaleString.call(this, locales, options);
};

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query) => {
      const events = new EventTarget();
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: (listener) => events.addEventListener("change", listener),
        removeListener: (listener) => events.removeEventListener("change", listener),
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
      };
    },
  });
}

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

if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.setCssProps !== "function") {
  HTMLElement.prototype.setCssProps = function (props) {
    for (const [name, value] of Object.entries(props)) {
      this.style.setProperty(name, value);
    }
  };
}

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

if (typeof window.activeDocument === "undefined") {
  window.activeDocument = window.document;
}
if (typeof window.activeWindow === "undefined") {
  window.activeWindow = window;
}
