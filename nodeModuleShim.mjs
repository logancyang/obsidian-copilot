// Node.js built-in modules to leave external: they exist in the Electron
// renderer both bundles run in, so esbuild must not try to resolve them from
// disk. `@anthropic-ai/claude-agent-sdk` and its transitive deps mix the
// prefixed and bare spellings, so both have to be covered, but the two sides
// cannot be covered the same way:
//
// - `node:` specifiers can only ever be builtins, so one wildcard covers every
//   present and future one. `node:module` is the exception the wildcard cannot
//   express — `nodeModuleShim` below claims it first, because the renderer has
//   no ESM `createRequire`.
// - Bare specifiers are ambiguous: `events`, `process`, `punycode`, and friends
//   are also real npm packages, and externalizing one would shadow a dependency
//   that legitimately resolves to `node_modules`. So bare spellings stay an
//   explicit list of the ones the module graph actually reaches.
export const nodeBuiltinExternals = [
  "node:*",
  "async_hooks",
  "child_process",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "os",
  "path",
  "process",
  "readline",
  "url",
  "util",
];

// Plugin to provide a shim for node:module in browser/Electron renderer context
const nodeModuleShim = {
  name: "node-module-shim",
  setup(build) {
    // Intercept node:module / module imports and provide a shim. Both prefixed
    // and bare forms are matched — @anthropic-ai/claude-agent-sdk imports the
    // bare form, while @langchain/community uses node:module.
    build.onResolve({ filter: /^(node:)?module$/ }, (args) => {
      return {
        path: args.path,
        namespace: "node-module-shim",
      };
    });

    build.onLoad({ filter: /.*/, namespace: "node-module-shim" }, () => {
      return {
        contents: `
// Shim for node:module in Electron/Obsidian environment (CommonJS format)
module.exports = {
  createRequire: function(filename) {
    // In Electron renderer, we can use the global require
    // Note: filename parameter is ignored (may be undefined from @langchain/community v1.0.0)
    if (typeof require !== 'undefined') {
      return require;
    }
    // Fallback: return a function that throws a helpful error
    return function shimmedRequire(id) {
      throw new Error('Dynamic require of "' + id + '" is not supported in this environment');
    };
  }
};
`,
        loader: "js",
      };
    });
  },
};

export default nodeModuleShim;
