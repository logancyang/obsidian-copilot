// Plugin to provide shims for node modules in browser/Electron renderer context
const nodeModuleShim = {
  name: "node-module-shim",
  setup(build) {
    // Intercept node:module imports and provide a shim
    build.onResolve({ filter: /^node:module$/ }, (args) => {
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

    // Intercept 'process/' imports (npm polyfill package) and redirect to Node builtin
    // This is needed because readable-stream uses require('process/') which is a polyfill
    // In Electron, we have access to the real Node.js process object
    build.onResolve({ filter: /^process\/$/ }, () => {
      return {
        path: "process/",
        namespace: "process-shim",
      };
    });

    build.onLoad({ filter: /.*/, namespace: "process-shim" }, () => {
      return {
        contents: `module.exports = require('process');`,
        loader: "js",
      };
    });
  },
};

export default nodeModuleShim;
