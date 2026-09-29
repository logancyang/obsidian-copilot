"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const PACKAGE_PATH = /^(.*[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/@][^\\/]*))([\\/].*)?$/;
const TOP_NODE_MODULES = /^(.*?[\\/]node_modules)[\\/]/;
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

// npm nests a private copy of a small dependency next to each package whose pinned version differs
// from the hoisted one, and esbuild bundles every copy. Two copies are interchangeable only when
// they have the same name and version, hold byte-identical files, and every dependency they declare
// resolves to an interchangeable copy from each location. Interchangeable copies resolve to the
// shallowest, alphabetically first one installed, so a package never gains a dependency it did not
// resolve before and the bundle does not depend on the order esbuild resolves imports in. A
// dependency cycle between copies is treated as not interchangeable.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
function createDedupeIdenticalPackages() {
  return {
    name: "dedupe-identical-packages",
    setup(build) {
      let inventories = new Map();
      let manifests = new Map();
      let digests = new Map();
      let verdicts = new Map();

      // An install can replace a package between rebuilds of a long-lived watch context.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      build.onStart(() => {
        inventories = new Map();
        manifests = new Map();
        digests = new Map();
        verdicts = new Map();
      });

      const readManifest = (root) => {
        if (!manifests.has(root)) {
          try {
            manifests.set(
              root,
              JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
            );
          } catch {
            manifests.set(root, null);
          }
        }
        return manifests.get(root);
      };

      const identityOf = (root) => {
        const manifest = readManifest(root);
        return manifest ? `${manifest.name}@${manifest.version}` : null;
      };

      const digestOf = (root) => {
        if (!digests.has(root)) {
          const hash = crypto.createHash("sha256");
          const visit = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            entries.sort((left, right) => (left.name < right.name ? -1 : 1));
            for (const entry of entries) {
              if (entry.name === "node_modules") continue;
              const entryPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                visit(entryPath);
              } else {
                hash.update(path.relative(root, entryPath)).update("\0");
                hash.update(fs.readFileSync(entryPath)).update("\0");
              }
            }
          };
          try {
            visit(root);
            digests.set(root, hash.digest("hex"));
          } catch {
            digests.set(root, null);
          }
        }
        return digests.get(root);
      };

      // Every package root under one top-level node_modules, grouped by name and version.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      const inventoryOf = (nodeModules) => {
        if (inventories.has(nodeModules)) return inventories.get(nodeModules);
        const groups = new Map();
        const visited = new Set();
        const scan = (dir) => {
          let names;
          try {
            names = fs.readdirSync(dir);
          } catch {
            return;
          }
          for (const name of names) {
            if (name.startsWith(".")) continue;
            const entries = name.startsWith("@")
              ? fs.readdirSync(path.join(dir, name)).map((child) => path.join(name, child))
              : [name];
            for (const entry of entries) {
              const root = path.join(dir, entry);
              const identity = identityOf(root);
              if (!identity) continue;
              const real = fs.realpathSync(root);
              if (visited.has(real)) continue;
              visited.add(real);
              groups.set(identity, [...(groups.get(identity) ?? []), root]);
              scan(path.join(root, "node_modules"));
            }
          }
        };
        scan(nodeModules);
        for (const roots of groups.values()) {
          roots.sort(
            (left, right) =>
              left.split(path.sep).length - right.split(path.sep).length || (left < right ? -1 : 1)
          );
        }
        inventories.set(nodeModules, groups);
        return groups;
      };

      const installedRoot = (fromRoot, dependency) => {
        const lookupDirs = createRequire(path.join(fromRoot, "package.json")).resolve.paths(
          dependency
        );
        for (const dir of lookupDirs ?? []) {
          const candidate = path.join(dir, dependency);
          if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
        }
        return null;
      };

      const compare = (left, right) => {
        const identity = identityOf(left);
        if (!identity || identity !== identityOf(right)) return false;
        const digest = digestOf(left);
        if (!digest || digest !== digestOf(right)) return false;
        const manifest = readManifest(left);
        const dependencies = new Set(
          DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}))
        );
        for (const dependency of dependencies) {
          const leftDependency = installedRoot(left, dependency);
          const rightDependency = installedRoot(right, dependency);
          if (!leftDependency || !rightDependency) {
            if (leftDependency !== rightDependency) return false;
          } else if (!areInterchangeable(leftDependency, rightDependency)) {
            return false;
          }
        }
        return true;
      };

      const areInterchangeable = (left, right) => {
        if (left === right) return true;
        const key = left < right ? `${left}\0${right}` : `${right}\0${left}`;
        if (!verdicts.has(key)) {
          verdicts.set(key, false);
          verdicts.set(key, compare(left, right));
        }
        return verdicts.get(key);
      };

      // Only imports of a package that npm installed more than once go through the plugin. Routing
      // every import through an asynchronous resolver makes esbuild's minified output differ from
      // one build to the next, and it drops `sideEffects` tree-shaking for the packages it touches.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      const nodeModules = path.join(
        build.initialOptions.absWorkingDir ?? process.cwd(),
        "node_modules"
      );
      const duplicated = [...inventoryOf(nodeModules)]
        .filter(([, roots]) => roots.length > 1)
        .map(([identity]) => identity.slice(0, identity.lastIndexOf("@")));
      if (duplicated.length === 0) return;
      const names = [...new Set(duplicated)].map((name) => name.replace(/\W/g, "\\$&"));
      const filter = new RegExp(`^(${names.join("|")})(/|$)`);

      build.onResolve({ filter }, async (args) => {
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
        const identity = match ? identityOf(match[1]) : null;
        if (!match || !identity) return resolved;

        const nodeModules = TOP_NODE_MODULES.exec(resolved.path)[1];
        const copies = inventoryOf(nodeModules).get(identity) ?? [];
        const canonicalRoot = copies.find((copy) => areInterchangeable(copy, match[1])) ?? match[1];
        if (canonicalRoot === match[1]) return resolved;
        const canonicalPath = canonicalRoot + (match[3] ?? "");
        return fs.existsSync(canonicalPath) ? { ...resolved, path: canonicalPath } : resolved;
      });
    },
  };
}

module.exports = { createDedupeIdenticalPackages };
