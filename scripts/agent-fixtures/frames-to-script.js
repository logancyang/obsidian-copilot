#!/usr/bin/env node

async function main() {
  const [{ build }, fs, os, path, url] = await Promise.all([
    import("esbuild"),
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
    import("node:url"),
  ]);

  const entryFile = path.resolve(__dirname, "frames-to-script.ts");
  const outfile = path.join(os.tmpdir(), `frames-to-script-${Date.now()}.mjs`);

  const obsidianStubPlugin = {
    name: "obsidian-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({
        path: path.resolve(__dirname, "../stubs/obsidian.ts"),
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
    tsconfig: path.resolve(__dirname, "../../tsconfig.json"),
    loader: { ".md": "text", ".svg": "text" },
    plugins: [obsidianStubPlugin],
    external: ["@anthropic-ai/claude-agent-sdk", "@agentclientprotocol/sdk"],
  });

  try {
    // eslint-disable-next-line no-unsanitized/method -- outfile is a controlled path under os.tmpdir(), produced by the esbuild step above.
    const module = await import(url.pathToFileURL(outfile).href);
    const [framesPath, backendId, ...rest] = process.argv.slice(2);
    const flag = (name) => rest[rest.indexOf(name) + 1];
    const text = await fs.readFile(framesPath, "utf8");
    const list = rest.includes("--list");
    const output = await module.convert(text, backendId, {
      list,
      segment: Number(flag("--segment")),
      name: flag("--name"),
    });
    if (list) process.stdout.write(output);
    else {
      await fs.writeFile(flag("--out"), output);
      process.stdout.write(`wrote ${flag("--out")}\n`);
    }
  } finally {
    await fs.unlink(outfile).catch(() => {});
  }
}

main().catch((error) => {
  console.error("Failed to convert frames:", error);
  process.exitCode = 1;
});
