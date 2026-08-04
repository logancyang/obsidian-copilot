import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["dev/gallery/main.ts"],
  bundle: true,
  // `node:*` matches the production bundle: the gallery plugin loads in the same
  // Electron renderer, and a story for a component that transitively touches a
  // Node builtin (e.g. BinaryPathSetting's binary detection) must not fail to
  // bundle just because the module graph reaches one.
  external: ["obsidian", "electron", "node:*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dev/gallery/main.js",
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
