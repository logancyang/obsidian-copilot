#!/usr/bin/env node

/**
 * Bundle the TypeScript entry file into a temporary ESM module and execute it.
 */
async function main() {
  const [{ build }, fs, os, path, url] = await Promise.all([
    import("esbuild"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
    import("node:url"),
  ]);

  const entryFile = path.resolve(__dirname, "printPromptDebugEntry.ts");
  const outfile = path.join(os.tmpdir(), `prompt-debug-${Date.now()}.mjs`);

  if (!Array.prototype.contains) {
    Object.defineProperty(Array.prototype, "contains", {
      value(value) {
        return this.includes(value);
      },
      enumerable: false,
    });
  }

  const obsidianStubPlugin = {
    name: "obsidian-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({
        path: path.resolve(__dirname, "stubs/obsidian.ts"),
      }));
    },
  };

  await build({
    entryPoints: [entryFile],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: false,
    target: "node18",
    tsconfig: path.resolve(__dirname, "../tsconfig.json"),
    plugins: [obsidianStubPlugin],
  });

  try {
    const module = await import(url.pathToFileURL(outfile).href);
    await module.run(process.argv.slice(2));
  } finally {
    await fs.unlink(outfile).catch(() => {
      /* ignore cleanup errors */
    });
  }
}

main().catch((error) => {
  console.error("Failed to generate prompt debug report:", error);
  process.exitCode = 1;
});
