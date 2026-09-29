"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE_PATH = /^(.*[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/@][^\\/]*))([\\/].*)?$/;
const BARE_SPECIFIER = /^[^./]/;

// npm nests a private copy of a small dependency next to each package whose pinned version differs
// from the hoisted one, and esbuild bundles every copy. Copies of the same name and version are
// interchangeable, so they resolve to the first copy the build meets.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
function createDedupeIdenticalPackages() {
  return {
    name: "dedupe-identical-packages",
    setup(build) {
      const canonicalRoots = new Map();
      const versions = new Map();

      const readVersion = (root) => {
        if (!versions.has(root)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
            versions.set(root, `${manifest.name}@${manifest.version}`);
          } catch {
            versions.set(root, null);
          }
        }
        return versions.get(root);
      };

      build.onResolve({ filter: BARE_SPECIFIER }, async (args) => {
        if (args.pluginData?.dedupeIdenticalPackages || args.kind === "entry-point") return;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          with: args.with,
          pluginData: { dedupeIdenticalPackages: true },
        });
        if (resolved.errors.length > 0) return;
        if (resolved.external || resolved.namespace !== "file") return resolved;
        const match = PACKAGE_PATH.exec(resolved.path);
        const identity = match ? readVersion(match[1]) : null;
        if (!match || !identity) return resolved;
        const canonicalRoot = canonicalRoots.get(identity) ?? match[1];
        canonicalRoots.set(identity, canonicalRoot);
        if (canonicalRoot === match[1]) return resolved;
        const canonicalPath = canonicalRoot + (match[3] ?? "");
        return fs.existsSync(canonicalPath) ? { ...resolved, path: canonicalPath } : resolved;
      });
    },
  };
}

module.exports = { createDedupeIdenticalPackages };
