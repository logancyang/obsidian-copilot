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
  // Quick Chat settings must not load desktop agents on mobile.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/373
  "src/settings/v2/components/BasicSettings.tsx",
  "src/settings/v2/components/QuickChatPanel.tsx",
  "src/settings/v2/components/ChatModelEnableList.tsx",
  "src/settings/v2/components/configuredModelGrouping.ts",
  "src/components/chat-components/plugins/SlashCommandPlugin.tsx",
  "src/components/chat-components/plugins/slashMenuItems.ts",
];

const contextCacheConsumerFiles = [
  "src/commands/index.ts",
  "src/components/project/agentProcessingAdapter.ts",
  "src/utils/cacheFileOpener.ts",
];

const protocolEntry = "src/agentMode/protocol/index.ts";
const mobileEntry = "src/agentMode/mobile/index.ts";
const legacyMobileChatEntry = "src/components/CopilotView.tsx";

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
      if (/from\s+["']@\/agentMode\/protocol(?:\/[^"']*)?["']/.test(statement)) continue;
      if (!isTypeOnlyImport(statement)) {
        fail(`${relativePath}: value import from Agent Mode is on the mobile load path.`);
      }
    }

    const dynamicImports = Array.from(source.matchAll(dynamicAgentModeImport));
    if (dynamicImports.length > 0 && !source.includes("isDesktopRuntime")) {
      fail(
        `${relativePath}: dynamic Agent Mode import must be gated by isDesktopRuntime() ` +
          `— Platform.isDesktopApp is true under app.emulateMobile(true).`
      );
    }
  }
}

function listSourceFiles(relativeDir) {
  return fs
    .readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) return listSourceFiles(relativePath);
      return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)
        ? [relativePath]
        : [];
    });
}

// The desktop listener imports Node built-ins and must load only behind isDesktopRuntime().
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
function checkRemoteImportBoundaries() {
  const staticHostImport =
    /import\s+(?:type\s+)?[^;]+?\s+from\s+["']@\/remote\/host(?:\/[^"']*)?["']\s*;?/g;
  const dynamicHostImport = /import\s*\(\s*["']@\/remote\/host(?:\/[^"']*)?["']\s*\)/g;
  const nodeImport =
    /from\s+["'](?:node:)?(?:fs|os|http|https|net|tls|crypto|stream|zlib|child_process|path|ws)["']|requireNodeModule/;

  for (const relativePath of loadCriticalFiles.concat(
    "src/settings/v2/components/RemoteSettings.tsx"
  )) {
    const source = readRepoFile(relativePath);
    for (const match of source.matchAll(staticHostImport)) {
      if (!isTypeOnlyImport(match[0])) {
        fail(`${relativePath}: value import from the Remote host is on the mobile load path.`);
      }
    }
    if (
      Array.from(source.matchAll(dynamicHostImport)).length > 0 &&
      !source.includes("isDesktopRuntime")
    ) {
      fail(`${relativePath}: dynamic Remote host import must be gated by isDesktopRuntime().`);
    }
  }

  const phoneFiles = [
    ...listSourceFiles("src/remote/client"),
    ...listSourceFiles("src/remote/ui"),
    ...["address", "channel", "hostState", "pairingLink", "wire"].map(
      (name) => `src/remote/${name}.ts`
    ),
  ];
  for (const relativePath of phoneFiles) {
    const source = readRepoFile(relativePath);
    if (nodeImport.test(source))
      fail(`${relativePath}: the phone loads this file, so it may not use Node.`);
    for (const match of source.matchAll(staticHostImport)) {
      if (!isTypeOnlyImport(match[0]))
        fail(`${relativePath}: the phone may not import the Remote host.`);
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

function checkProtocolBundle() {
  const { buildSync } = require("esbuild");
  let result;
  try {
    result = buildSync({
      entryPoints: [path.join(repoRoot, protocolEntry)],
      bundle: true,
      write: false,
      metafile: true,
      platform: "browser",
      format: "cjs",
      target: "es2020",
      external: ["react", "obsidian"],
      logLevel: "silent",
      tsconfig: path.join(repoRoot, "tsconfig.json"),
    });
  } catch (error) {
    fail(`${protocolEntry} does not bundle for a browser platform: ${formatError(error)}`);
    return;
  }

  const protocolDir = "src/agentMode/protocol/";
  const outsiders = Object.keys(result.metafile.inputs).filter(
    (input) => !input.startsWith(protocolDir) && !input.startsWith("node_modules/")
  );
  if (outsiders.length > 0) {
    fail(`${protocolEntry} reaches outside the protocol layer: ${outsiders.join(", ")}`);
    return;
  }

  const module = { exports: {} };
  const react = {
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore() {},
  };
  try {
    vm.runInNewContext(result.outputFiles[0].text, {
      module,
      exports: module.exports,
      require(id) {
        if (id === "react") return react;
        if (nodeModuleIds.has(id) || id === "obsidian") return createPoisonModule(id);
        throw new Error(`mobile-load-smoke: unexpected protocol external '${id}'.`);
      },
    });
  } catch (error) {
    fail(`${protocolEntry} failed to evaluate without Node or Obsidian: ${formatError(error)}`);
    return;
  }
  for (const name of ["SessionClient", "applyTranscriptOp", "applyHostOp", "applySessionOp"]) {
    if (typeof module.exports[name] !== "function")
      fail(`${protocolEntry} does not export ${name}.`);
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

function bundleContext(module) {
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
  return context;
}

// Evaluates a browser bundle the way the mobile WebView does: Node built-ins and electron throw on
// first use and obsidian is a stub. Returns the bundle's exports, or null after recording a failure.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
function evaluateBundle(source, filename) {
  const module = { exports: {} };
  try {
    vm.runInNewContext(source, bundleContext(module), { filename, timeout: 5000 });
  } catch (error) {
    fail(`${filename} failed mobile bundle evaluation: ${formatError(error)}`);
    return null;
  }
  return module.exports;
}

function runBundleEvaluationSmoke() {
  const bundlePath = path.join(repoRoot, "main.js");
  if (!fs.existsSync(bundlePath)) {
    fail("main.js is missing. Run npm run build before the mobile-load smoke test.");
    return;
  }

  const exports = evaluateBundle(fs.readFileSync(bundlePath, "utf8"), "main.js");
  if (!exports) return;
  const pluginExport = exports.default ?? exports;
  if (typeof pluginExport !== "function") {
    fail("main.js did not export the plugin class.");
  }
}

const desktopOnlyAgentInputs = new RegExp(
  "^src/agentMode/(?:acp|sdk|backends|skills)/|^src/agentMode/index\\.ts$|" +
    "^src/agentMode/session/(?:AgentSession|AgentSessionManager|AgentMessageStore|" +
    "AgentChatPersistenceManager|AgentModelPreloader|AgentSessionIndex|nodeFileStorage|debugSink)\\.ts$|" +
    "^src/agentMode/session/host/|^src/remote/host/"
);

async function bundleForMobile(entry) {
  const { build } = require("esbuild");
  const { default: nodeModuleShim, nodeBuiltinExternals } = require("../nodeModuleShim.mjs");
  const { default: svgrPlugin } = require("../svgrPlugin.mjs");
  return build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "cjs",
    target: "es2020",
    charset: "utf8",
    logLevel: "silent",
    tsconfig: path.join(repoRoot, "tsconfig.json"),
    loader: { ".md": "text" },
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...nodeBuiltinExternals],
    plugins: [nodeModuleShim, svgrPlugin],
    define: {
      global: "window",
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "import_meta.url",
    },
  });
}

function entryInput(metafile) {
  return Object.values(metafile.outputs)[0].entryPoint;
}

// The files an entry loads at module evaluation: static imports only, since a dynamic import is
// wrapped and runs later.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
function staticClosure(metafile, entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of metafile.inputs[current]?.imports ?? []) {
      if (edge.external || edge.kind === "dynamic-import" || seen.has(edge.path)) continue;
      seen.add(edge.path);
      queue.push(edge.path);
    }
  }
  return seen;
}

function nodeImporters(metafile, closure) {
  const importers = new Set();
  for (const file of closure) {
    for (const edge of metafile.inputs[file]?.imports ?? []) {
      if (edge.external && edge.kind !== "dynamic-import" && nodeModuleIds.has(edge.path)) {
        importers.add(file);
      }
    }
  }
  return importers;
}

// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
async function checkMobileEntryBundle() {
  let phone;
  let legacy;
  try {
    [phone, legacy] = await Promise.all([
      bundleForMobile(mobileEntry),
      bundleForMobile(legacyMobileChatEntry),
    ]);
  } catch (error) {
    fail(`${mobileEntry} does not bundle for a browser platform: ${formatError(error)}`);
    return;
  }

  const files = staticClosure(phone.metafile, entryInput(phone.metafile));
  if (process.env.SMOKE_DEBUG)
    console.log("phone closure", files.size, "bytes", phone.outputFiles[0].text.length);

  const desktopOnly = [...files].filter((file) => desktopOnlyAgentInputs.test(file));
  if (desktopOnly.length > 0) {
    fail(`${mobileEntry} loads desktop-only modules: ${desktopOnly.join(", ")}`);
  }
  const sdkPackages = [...files].filter((file) =>
    /^node_modules\/(?:@anthropic-ai\/claude-agent-sdk|@agentclientprotocol)\//.test(file)
  );
  if (sdkPackages.length > 0) {
    fail(`${mobileEntry} loads agent SDK packages: ${sdkPackages.join(", ")}`);
  }

  // What the legacy chat already loads on a phone today is known to work there; the agent entry
  // may not add a Node or electron import to it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
  const alreadyOnPhone = nodeImporters(
    legacy.metafile,
    staticClosure(legacy.metafile, entryInput(legacy.metafile))
  );
  const added = [...nodeImporters(phone.metafile, files)].filter(
    (file) => !alreadyOnPhone.has(file)
  );
  if (added.length > 0) {
    fail(
      `${mobileEntry} adds Node or electron imports the phone does not load today: ${added.join(", ")}`
    );
  }

  const exports = evaluateBundle(phone.outputFiles[0].text, "agentMode/mobile/index.ts");
  if (exports && typeof exports.RemoteAgentView !== "function") {
    fail(`${mobileEntry} does not export RemoteAgentView.`);
  }
}

async function main() {
  checkAgentModeImportBoundaries();
  checkContextCacheImportBoundaries();
  checkRemoteImportBoundaries();
  checkProtocolBundle();
  await checkMobileEntryBundle();
  runBundleEvaluationSmoke();

  if (failures.length > 0) {
    console.error("Mobile load smoke test failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Mobile load smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
