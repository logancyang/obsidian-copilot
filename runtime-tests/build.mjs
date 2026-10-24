// Bundles the runtime suite with esbuild — the same mechanism that builds the
// plugin itself, and the only one that satisfies all of this suite's
// resolution needs in one step: alias `obsidian` (types-only at runtime) to the
// shim, resolve the `@/` alias, and load the `.svg` / `.md` assets that
// production Agent Mode modules import. Every other import, including the ACP
// SDK, resolves from `node_modules`, so Jest's `moduleNameMapper` mocks are out
// of reach by construction.
import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import svgrPlugin from "../svgrPlugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const shimPath = resolve(here, "harness/obsidianShim.ts");

/**
 * Serve `obsidian` from the shim, appending an inert class for every export the
 * real package declares that the shim does not implement. Production modules
 * reach `obsidian` for dozens of UI symbols they only subclass or type against;
 * generating those keeps the checked-in shim limited to the APIs whose
 * behaviour the suite actually depends on.
 */
const obsidianShimPlugin = {
  name: "obsidian-shim",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: shimPath, namespace: "file" }));
    build.onLoad({ filter: /obsidianShim\.ts$/ }, async (args) => {
      const shim = await readFile(args.path, "utf8");
      const declared = new Set(
        [...shim.matchAll(/export (?:async )?(?:class|function|const) (\w+)/g)].map((m) => m[1])
      );
      const dts = await readFile(resolve(repoRoot, "node_modules/obsidian/obsidian.d.ts"), "utf8");
      const stubs = [
        ...dts.matchAll(
          /^export (?:declare )?(?:abstract )?(?:class|interface|function|const|let|var|enum) (\w+)/gm
        ),
      ]
        .map((m) => m[1])
        .filter((name) => !declared.has(name));
      const generated = [...new Set(stubs)].map((name) => `export class ${name} {}`).join("\n");
      return { contents: `${shim}\n${generated}\n`, loader: "ts", resolveDir: dirname(args.path) };
    });
  },
};

/**
 * Serve Copilot's `Markdown` component as its source text. The real one hands
 * the text to Obsidian's renderer after mount, which a static render never
 * reaches, so a rendered chat component would show an empty box where its
 * answer is.
 */
const markdownTextPlugin = {
  name: "markdown-text",
  setup(build) {
    build.onResolve({ filter: /^@\/components\/Markdown$/ }, () => ({
      path: "markdown-text",
      namespace: "markdown-text",
    }));
    build.onLoad({ filter: /.*/, namespace: "markdown-text" }, () => ({
      contents:
        'import { createElement } from "react";\n' +
        "export function Markdown({ className, text }) { return createElement('div', { className }, text); }\n",
      loader: "js",
      resolveDir: repoRoot,
    }));
  },
};

await esbuild.build({
  // Flat output names, so `__dirname` inside the bundle is always `.build/`.
  entryPoints: [
    { in: resolve(here, "steps/index.ts"), out: "steps" },
    { in: resolve(here, "bin/fetchOpencode.ts"), out: "fetch-opencode" },
  ],
  outdir: resolve(here, ".build"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  // ESM, because some bundled React dependencies use top-level await, which
  // esbuild cannot lower into CJS. The banner restores the CommonJS globals the
  // bundled production code still uses (`requireNodeModule`'s dynamic
  // `require`, and `__dirname`).
  format: "esm",
  banner: {
    js: [
      'import { createRequire as __cr } from "node:module";',
      'import { fileURLToPath as __furl } from "node:url";',
      'import { dirname as __dir } from "node:path";',
      "const require = __cr(import.meta.url);",
      "const __filename = __furl(import.meta.url);",
      "const __dirname = __dir(__filename);",
    ].join("\n"),
  },
  sourcemap: "inline",
  logLevel: "warning",
  // Cucumber must be the CLI's own instance, or `Given`/`When`/`Then` would
  // register into a second copy the runner never reads.
  external: ["@cucumber/cucumber"],
  plugins: [obsidianShimPlugin, markdownTextPlugin, svgrPlugin],
  loader: { ".md": "text" },
  tsconfig: resolve(repoRoot, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
});
