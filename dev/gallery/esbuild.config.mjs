import esbuild from "esbuild";
import process from "process";
import nodeModuleShim, { nodeBuiltinExternals } from "../../nodeModuleShim.mjs";
import svgrPlugin from "../../svgrPlugin.mjs";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["dev/gallery/main.ts"],
  bundle: true,
  // Node builtins stay external as in the production bundle: the gallery plugin
  // loads in the same Electron renderer, and a story for a component that
  // transitively touches a Node builtin (e.g. BinaryPathSetting's binary
  // detection) must not fail to bundle just because the module graph reaches one.
  external: ["obsidian", "electron", ...nodeBuiltinExternals],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dev/gallery/main.js",
  // `module` gets a shim rather than a slot in `external` because the renderer
  // has no ESM `createRequire`; `svgrPlugin` loads the backend logo SVGs.
  plugins: [nodeModuleShim, svgrPlugin],
  define: {
    global: "window",
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
