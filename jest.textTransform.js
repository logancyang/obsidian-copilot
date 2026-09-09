// Mirrors esbuild's `text` loader so `.md` imports resolve to their contents in tests.
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
