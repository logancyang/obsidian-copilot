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

const nodeModuleShim = {
  name: "node-module-shim",
  setup(build) {
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
