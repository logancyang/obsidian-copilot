export default {
  paths: ["runtime-tests/features/**/*.feature"],
  // The step definitions are pre-bundled by `runtime-tests/build.mjs`; see the
  // comment there for why the suite is bundled rather than transpiled in place.
  import: ["runtime-tests/.build/steps.mjs"],
  format: ["progress"],
  formatOptions: { snippetInterface: "async-await" },
  strict: true,
};
