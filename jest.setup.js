import { TextEncoder, TextDecoder } from "util";

// Node's own Response bodies reject polyfilled stream classes, which the MCP SDK client pipes them through, so only jsdom suites get the polyfill.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/857
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import can't be conditional
if (typeof ReadableStream === "undefined") require("web-streams-polyfill/dist/polyfill.min.js");

// Node-environment suites (real loopback HTTP and Web Crypto) run plugin code that schedules timers on `window`.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/23
// eslint-disable-next-line obsidianmd/no-global-this -- jest's node environment has no window to use instead
if (typeof window === "undefined") global.window = global;

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

// jsdom has no Web Animations API, which layout fades use so re-parented hosts do not restart them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/883
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function () {
    return { cancel() {}, finished: Promise.resolve() };
  };
}

// jsdom rejects `:focus-visible` and tracks no input modality, so tests treat every focus as keyboard focus.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
if (typeof Element !== "undefined") {
  const nativeMatches = Element.prototype.matches;
  Element.prototype.matches = function (selectors) {
    return nativeMatches.call(this, selectors.replaceAll(":focus-visible", ":focus"));
  };
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

if (
  typeof HTMLElement !== "undefined" &&
  typeof HTMLElement.prototype.onWindowMigrated !== "function"
) {
  HTMLElement.prototype.onWindowMigrated = function () {
    return () => {};
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
