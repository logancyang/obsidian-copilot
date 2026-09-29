import esbuild from "esbuild";
import process from "process";
import nodeModuleShim, { nodeBuiltinExternals } from "../../nodeModuleShim.mjs";
import svgrPlugin from "../../svgrPlugin.mjs";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["dev/gallery/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...nodeBuiltinExternals],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dev/gallery/main.js",
  loader: { ".md": "text" },
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
