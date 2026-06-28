"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const failures = [];

const loadCriticalFiles = [
  "src/main.ts",
  "src/commands/index.ts",
  "src/settings/SettingsPage.tsx",
  "src/settings/v2/SettingsMainV2.tsx",
  "src/settings/v2/components/AdvancedSettings.tsx",
  "src/components/chat-components/plugins/SlashCommandPlugin.tsx",
  "src/components/chat-components/plugins/slashMenuItems.ts",
];

const contextCacheConsumerFiles = [
  "src/commands/index.ts",
  "src/components/project/agentProcessingAdapter.ts",
  "src/utils/cacheFileOpener.ts",
];

const nodeModuleIds = new Set([
  "async_hooks",
  "buffer",
  "child_process",
  "crypto",
  "electron",
  "events",
  "fs",
  "fs/promises",
  "module",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "url",
  "util",
  "node:async_hooks",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:fs/promises",
  "node:module",
  "node:os",
  "node:path",
  "node:process",
  "node:readline",
  "node:stream",
  "node:url",
  "node:util",
]);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);

  const stackLines = (error.stack ?? "")
    .split("\n")
    .filter((line) => !line.includes("main.js:1:"))
    .slice(0, 6);

  return [`${error.name}: ${error.message}`, ...stackLines.slice(1)].join("\n");
}

function isTypeOnlyImport(importStatement) {
  if (/^import\s+type\b/.test(importStatement.trim())) return true;
  const named = importStatement.match(/import\s*\{([^}]*)\}\s*from/);
  if (!named) return false;
  const specifiers = named[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return specifiers.length > 0 && specifiers.every((part) => part.startsWith("type "));
}

function checkAgentModeImportBoundaries() {
  const staticAgentModeImport =
    /import\s+(?:type\s+)?[^;]+?\s+from\s+["']@\/agentMode(?:\/[^"']*)?["']\s*;?/g;
  const dynamicAgentModeImport = /import\s*\(\s*["']@\/agentMode(?:\/[^"']*)?["']\s*\)/g;

  for (const relativePath of loadCriticalFiles) {
    const source = readRepoFile(relativePath);

    for (const match of source.matchAll(staticAgentModeImport)) {
      const statement = match[0];
      if (!isTypeOnlyImport(statement)) {
        fail(`${relativePath}: value import from Agent Mode is on the mobile load path.`);
      }
    }

    // Every dynamic Agent Mode import must be gated by `isDesktopRuntime()`,
    // NOT a bare `Platform.isDesktopApp`: the latter stays `true` under
    // `app.emulateMobile(true)` (which stubs Node to null), so it does not keep the
    // `@/agentMode` barrel off the emulated-mobile load path and the plugin crashes.
    const dynamicImports = Array.from(source.matchAll(dynamicAgentModeImport));
    if (dynamicImports.length > 0 && !source.includes("isDesktopRuntime")) {
      fail(
        `${relativePath}: dynamic Agent Mode import must be gated by isDesktopRuntime() ` +
          `— Platform.isDesktopApp is true under app.emulateMobile(true).`
      );
    }
  }
}

function checkContextCacheImportBoundaries() {
  const desktopOnlyImports =
    /import\s+(?:type\s+)?[^;]+?\s+from\s+["']@\/context\/(?:conversionsLocation|contextCacheFs)["']\s*;?/g;

  for (const relativePath of contextCacheConsumerFiles) {
    const source = readRepoFile(relativePath);
    for (const match of source.matchAll(desktopOnlyImports)) {
      const statement = match[0];
      if (!isTypeOnlyImport(statement)) {
        fail(
          `${relativePath}: value import from ${statement.match(/["']([^"']+)["']/)?.[1]} ` +
            "is on the mobile load path; use a desktop-gated dynamic import."
        );
      }
    }
  }
}

function createCallableStub(name) {
  function Stub() {}
  Object.defineProperty(Stub, "name", { value: name.replace(/[^A-Za-z0-9_$]/g, "_") || "Stub" });
  return new Proxy(Stub, {
    apply() {
      return undefined;
    },
    construct() {
      return {};
    },
    get(target, prop) {
      if (prop === "prototype") return target.prototype;
      if (prop === Symbol.toStringTag) return name;
      return createCallableStub(`${name}.${String(prop)}`);
    },
  });
}

function createPoisonModule(id) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === Symbol.toStringTag) return id;
        throw new Error(
          `mobile-load-smoke: desktop-only module '${id}' was accessed at '${String(prop)}'.`
        );
      },
    }
  );
}

function isObsidianBrowserExternal(id) {
  return id.startsWith("@codemirror/") || id.startsWith("@lezer/");
}

function createObsidianStub() {
  class Component {
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {}
    load() {}
    unload() {}
  }

  class Plugin extends Component {
    constructor(app, manifest) {
      super();
      this.app = app;
      this.manifest = manifest ?? { id: "copilot", version: "mobile-load-smoke" };
    }

    addCommand() {}
    addRibbonIcon() {
      return { addClass() {}, removeClass() {}, setAttribute() {} };
    }
    addSettingTab() {}
    loadData() {
      return Promise.resolve(null);
    }
    saveData() {
      return Promise.resolve();
    }
    registerView() {}
    registerEditorExtension() {}
  }

  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = { empty() {}, addClass() {}, createDiv: () => ({}) };
    }
  }

  class ItemView extends Component {
    constructor(leaf) {
      super();
      this.leaf = leaf;
      this.containerEl = {};
      this.contentEl = {};
    }
  }

  class Modal extends Component {
    constructor(app) {
      super();
      this.app = app;
    }
    open() {}
    close() {}
  }

  class Notice {
    constructor() {}
  }

  class TFile {}
  class TFolder {}
  class FileSystemAdapter {}
  class MarkdownView {}

  const obsidian = {
    App: class App {},
    Component,
    FileSystemAdapter,
    ItemView,
    MarkdownView,
    Modal,
    Notice,
    Platform: Object.freeze({
      isDesktop: false,
      isDesktopApp: false,
      isMobile: true,
      isMobileApp: true,
      isMacOS: false,
      isPhone: true,
      isTablet: false,
      isWin: false,
    }),
    Plugin,
    PluginSettingTab,
    TFile,
    TFolder,
    WorkspaceLeaf: class WorkspaceLeaf {},
    MarkdownRenderer: { render: async () => {} },
    addIcon() {},
    debounce(fn) {
      return fn;
    },
    moment: () => ({ format: () => "" }),
    normalizePath(value) {
      return String(value).replace(/\\/g, "/");
    },
    parseYaml() {
      return {};
    },
    requestUrl: async () => ({ json: {}, text: "", status: 200 }),
    stringifyYaml() {
      return "";
    },
  };

  return new Proxy(obsidian, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return createCallableStub(`obsidian.${String(prop)}`);
    },
  });
}

class SmokeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class SmokeCustomEvent extends SmokeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

class SmokeEventTarget {
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

function runBundleEvaluationSmoke() {
  const bundlePath = path.join(repoRoot, "main.js");
  if (!fs.existsSync(bundlePath)) {
    fail("main.js is missing. Run npm run build before the mobile-load smoke test.");
    return;
  }

  const source = fs.readFileSync(bundlePath, "utf8");
  const module = { exports: {} };
  const context = {
    AbortController,
    clearInterval,
    clearTimeout,
    console,
    crypto: {
      getRandomValues(array) {
        array.fill(7);
        return array;
      },
      randomUUID() {
        return "00000000-0000-4000-8000-000000000000";
      },
    },
    CustomEvent: SmokeCustomEvent,
    Event: SmokeEvent,
    EventTarget: SmokeEventTarget,
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => "", body: null }),
    Blob,
    module,
    exports: module.exports,
    FormData,
    Headers,
    navigator: { userAgent: "ObsidianMobileSmoke/1.0" },
    Promise,
    queueMicrotask,
    ReadableStream,
    Request,
    Response,
    require(id) {
      if (id === "obsidian") return createObsidianStub();
      if (isObsidianBrowserExternal(id)) return createCallableStub(id);
      if (nodeModuleIds.has(id)) return createPoisonModule(id);
      throw new Error(`mobile-load-smoke: unexpected external require '${id}'.`);
    },
    setInterval,
    setTimeout,
    TextDecoder,
    TextEncoder,
    TransformStream,
    URL,
    URLSearchParams,
    WritableStream,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;

  try {
    vm.runInNewContext(source, context, {
      filename: "main.js",
      timeout: 5000,
    });
  } catch (error) {
    fail(`main.js failed mobile bundle evaluation: ${formatError(error)}`);
    return;
  }

  const pluginExport = module.exports.default ?? module.exports;
  if (typeof pluginExport !== "function") {
    fail("main.js did not export the plugin class.");
  }
}

checkAgentModeImportBoundaries();
checkContextCacheImportBoundaries();
runBundleEvaluationSmoke();

if (failures.length > 0) {
  console.error("Mobile load smoke test failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Mobile load smoke test passed.");
